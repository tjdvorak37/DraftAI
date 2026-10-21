import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';
import { randomUUID } from 'node:crypto';

test('purchasing and receiving roles keep counted arrivals idempotent and customer special orders allocated',async()=>{
  const {app,db}=createApp({databasePath:':memory:'});await provisionInitialAdmin(db,{name:'Supply Admin',email:'supply@test.com',password:'supply-test-password'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;let cookie='';
  async function request(path,body,session=cookie){const response=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:session},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  try{
    cookie=(await request('/auth/login',{email:'supply@test.com',password:'supply-test-password'})).cookie;
    for(const role of ['purchasing','receiving'])assert.equal((await request('/users',{name:`Supply ${role}`,email:`${role}@test.com`,password:'supply-worker-password',role,locationId:'MAIN'})).status,201);
    const buyer=(await request('/auth/login',{email:'purchasing@test.com',password:'supply-worker-password'})).cookie;
    const receiver=(await request('/auth/login',{email:'receiving@test.com',password:'supply-worker-password'})).cookie;
    assert.equal((await request('/inventory',{id:'SUP-1',name:'Special frame',category:'Steel',unit:'ea',stock:0,price:12,reorder:5,location:'',supplier:'Vendor',location_id:'MAIN'})).status,200);
    const address={line1:'Customer Road',city:'Audubon',region:'IA',postalCode:'50025',country:'US'};
    const customer=(await request('/customers',{name:'Special Farm',contactName:'Farm Owner',phone:'555-0100',billingAddress:address,shippingAddress:address})).data;assert.ok(customer.id,JSON.stringify(customer));
    const shipment=(await request('/shipments',{requestKey:randomUUID(),kind:'customer',sourceLocation:'MAIN',customerId:customer.id,reference:'SPECIAL-1',lines:[{partId:'SUP-1',quantity:3}]})).data;
    assert.ok(shipment.id,JSON.stringify(shipment));
    const purchase={requestKey:randomUUID(),supplier:'Vendor',supplierReference:'PO-1',locationId:'MAIN',linkedOrderId:shipment.id,lines:[{partId:'SUP-1',quantity:3}]};
    assert.equal((await request('/purchases',purchase,receiver)).status,403);
    const saved=await request('/purchases',purchase,buyer);assert.equal(saved.status,200);const id=saved.data.id;
    assert.equal((await request(`/purchases/${id}/action`,{action:'order',revision:1},buyer)).status,200);
    const receipt={requestKey:randomUUID(),revision:2,deliveryReference:'TRUCK-1',lines:[{partId:'SUP-1',accepted:2,rejected:1,bin:'Rack 3'}]};
    assert.equal((await request(`/purchases/${id}/receive`,receipt,buyer)).status,403);
    assert.equal((await request(`/purchases/${id}/receive`,receipt,receiver)).status,200);
    assert.equal((await request(`/purchases/${id}/receive`,receipt,receiver)).data.alreadyApplied,true);
    let balance=(await request('/inventory')).data.find(item=>item.id==='SUP-1');assert.equal(balance.stock,2);assert.equal(balance.reserved,2);assert.equal(balance.available,0);
    assert.equal((await request('/inventory',undefined,receiver)).data.find(item=>item.id==='SUP-1').price,null);
    assert.equal((await request(`/purchases/${id}/receive`,{...receipt,requestKey:randomUUID(),revision:3,lines:[{partId:'SUP-1',accepted:2,rejected:0}]},receiver)).status,409);
    assert.equal((await request(`/purchases/${id}/receive`,{...receipt,requestKey:randomUUID(),revision:3,lines:[{partId:'SUP-1',accepted:1,rejected:0}]},receiver)).status,200);
    let order=(await request('/shipments',undefined,receiver)).data.find(order=>order.id===shipment.id);assert.equal(order.status,'held');assert.equal(order.customer_snapshot.name,'Special Farm');
    assert.equal((await request(`/shipments/${order.id}/action`,{action:'stage',revision:order.revision,yardArea:'South / Row 2'},receiver)).status,200);
    balance=(await request('/inventory')).data.find(item=>item.id==='SUP-1');assert.equal(balance.stock,3);assert.equal(balance.staged,3);assert.equal(balance.held,0);
    order=(await request('/shipments')).data.find(order=>order.id===shipment.id);
    assert.equal((await request(`/shipments/${order.id}/action`,{action:'dispatch',revision:order.revision},receiver)).status,403);
    assert.equal((await request(`/shipments/${order.id}/action`,{action:'cancel',revision:order.revision})).status,200);
    balance=(await request('/inventory')).data.find(item=>item.id==='SUP-1');assert.equal(balance.stock,3);assert.equal(balance.available,3);assert.equal(balance.staged,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('employees default to their location and customers/shipments preserve audited stock and address snapshots',async()=>{
  const {app,db}=createApp({databasePath:':memory:'});await provisionInitialAdmin(db,{name:'Operations Admin',email:'operations@test.com',password:'operations-test-password'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;let cookie='';
  async function request(path,body,session=cookie){const response=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:session},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const address={line1:'100 Customer Road',line2:'',city:'Audubon',region:'IA',postalCode:'50025',country:'US'};
  try{
    cookie=(await request('/auth/login',{email:'operations@test.com',password:'operations-test-password'})).cookie;
    assert.equal((await request('/locations',{id:'WEST',name:'West site',address:'1 Warehouse Road',phone:'555-0100',active:true})).status,200);
    assert.equal((await request('/users',{name:'West Employee',email:'west@test.com',password:'west-test-password',role:'engineer',locationId:'WEST'})).status,201);
    const worker=(await request('/auth/login',{email:'west@test.com',password:'west-test-password'})).cookie;
    assert.equal((await request('/auth',undefined,worker)).data.user.locationId,'WEST');
    assert.equal((await request('/inventory',undefined,worker)).data.length,0);
    const part={id:'OPS-1',name:'Steel component',category:'Steel',unit:'ea',stock:10,price:15,reorder:0,location:'Rack A',supplier:'',location_id:'MAIN'};
    assert.equal((await request('/inventory',part)).status,200);
    assert.equal((await request('/inventory',{...part,stock:3,location_id:'WEST'})).status,200);
    const input={name:'Test Farm',accountNumber:'FARM-1',contactName:'Farm Manager',email:'farm@example.test',phone:'555-0101',website:'',billingAddress:address,shippingAddress:address,shippingInstructions:'Call before delivery.',contacts:[{name:'Site Contact',email:'site@example.test',phone:'555-0102',title:'Supervisor'}],notes:'Account-specific notes.',active:true};
    const customer=(await request('/customers',input)).data;
    assert.equal((await request('/customers',undefined,worker)).status,403);
    const shipment=(await request('/shipments',{requestKey:randomUUID(),kind:'customer',sourceLocation:'MAIN',destinationLocation:null,customerId:customer.id,lines:[{partId:part.id,quantity:4}],reference:'SO-100'})).data;
    assert.ok(shipment.id);
    assert.equal((await request(`/shipments/${shipment.id}/action`,{action:'hold',revision:1})).status,200);
    assert.equal((await request('/inventory?location=MAIN')).data.find(item=>item.id===part.id).available,6);
    assert.equal((await request('/inventory',{...part,stock:3})).status,409);
    assert.equal((await request(`/shipments/${shipment.id}/action`,{action:'dispatch',revision:2,carrier:'Local truck',tracking:'BOL-100'})).status,200);
    assert.equal((await request(`/shipments/${shipment.id}/action`,{action:'deliver',revision:3})).status,200);
    const saved=(await request('/customers')).data.find(item=>item.id===customer.id);
    assert.equal((await request('/customers',{...saved,shippingAddress:{...address,line1:'Changed shipping address'}})).status,200);
    assert.equal((await request('/customers',{...saved,name:'Outdated change'})).status,409);
    assert.equal((await request('/shipments')).data.find(item=>item.id===shipment.id).shipping_address.line1,'100 Customer Road');
    const transfer=(await request('/shipments',{requestKey:randomUUID(),kind:'transfer',sourceLocation:'MAIN',destinationLocation:'WEST',customerId:null,lines:[{partId:part.id,quantity:2}]})).data;
    for(const [action,revision]of[['hold',1],['dispatch',2],['receive',3]])assert.equal((await request(`/shipments/${transfer.id}/action`,{action,revision})).status,200);
    assert.equal((await request('/inventory',undefined,worker)).data.find(item=>item.id===part.id).stock,5);
    assert.equal((await request('/inventory?location=all')).data.find(item=>item.id===part.id).stock,9);
    assert.equal((await request(`/shipments/${transfer.id}/action`,{action:'receive',revision:3})).status,409);
    assert.equal((await request('/locations',{id:'WEST',name:'West site',active:false,address:'',phone:''})).status,409);
    assert.ok((await request('/stock-movements')).data.some(move=>move.event==='receive'));
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});