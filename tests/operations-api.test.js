import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { provisionInitialAdmin } from '../server/accounts.js';
import { randomUUID } from 'node:crypto';

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