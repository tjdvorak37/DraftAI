import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

async function database(){
  const db=new PGlite();const id='00000000-0000-4000-8000-000000000001';
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.mfa_factors(user_id uuid,status text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{"aal":"aal2"}'::jsonb$$;grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;insert into auth.users values('${id}');`);
  for(const file of ['202610200001_workspace.sql','202610200002_inventory_operations.sql','202610210001_yard_purchasing.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  await db.exec(`insert into profiles(id,name,email,role)values('${id}','Stock Admin','stock@example.test','admin');insert into locations(id,name)values('WEST','West site');set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);return db;
}

test('yard staging preserves physical stock, excludes staged units from availability, and creates threshold alerts',async()=>{
  const db=await database();try{
    await db.query('select save_inventory($1::jsonb)',[JSON.stringify({id:'YARD-1',name:'Finished panel',category:'Panels',unit:'ea',stock:10,price:null,reorder:5,location:'Plant',supplier:'Vendor',location_id:'MAIN'})]);
    const id=(await db.query('select create_stock_order($1::jsonb) id',[JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000010',kind:'transfer',sourceLocation:'MAIN',destinationLocation:'WEST',lines:[{partId:'YARD-1',quantity:6}]})])).rows[0].id;
    await db.query('select transition_stock_order($1,$2,$3)',[id,'hold',1]);
    await db.query('select transition_stock_order($1,$2,$3,null,null,$4)',[id,'stage',2,'Yard C / lane 2']);
    const staged=(await db.query("select inventory_listing('MAIN') items")).rows[0].items[0];
    assert.equal(staged.stock,10);assert.equal(staged.available,4);assert.equal(staged.staged,6);assert.equal(staged.held,0);
    assert.equal((await db.query('select yard_area from stock_orders where id=$1',[id])).rows[0].yard_area,'Yard C / lane 2');
    assert.equal((await db.query('select * from stock_alerts where active')).rows.length,1);
    const alert=(await db.query('select * from stock_alerts where active')).rows[0];
    await db.query('select acknowledge_stock_alert($1,$2)',[alert.id,alert.episode]);
    assert.ok((await db.query('select acknowledged_at from stock_alerts where id=$1',[alert.id])).rows[0].acknowledged_at);
    await db.query('select transition_stock_order($1,$2,$3)',[id,'unstage',3]);
    await db.query('select transition_stock_order($1,$2,$3)',[id,'cancel',4]);
    assert.equal((await db.query('select active from stock_alerts where id=$1',[alert.id])).rows[0].active,false);
    const second=(await db.query('select create_stock_order($1::jsonb) id',[JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000011',kind:'transfer',sourceLocation:'MAIN',destinationLocation:'WEST',lines:[{partId:'YARD-1',quantity:6}]})])).rows[0].id;
    await db.query('select transition_stock_order($1,$2,$3)',[second,'hold',1]);
    const reopened=(await db.query('select * from stock_alerts where id=$1',[alert.id])).rows[0];assert.equal(reopened.episode,alert.episode+1);assert.equal(reopened.acknowledged_at,null);
    await db.query('select transition_stock_order($1,$2,$3)',[second,'dispatch',2]);
    const dispatched=(await db.query("select inventory_listing('MAIN') items")).rows[0].items[0];assert.equal(dispatched.stock,4);assert.equal(dispatched.staged,0);assert.equal(dispatched.available,4);
    await assert.rejects(()=>db.query('select transition_stock_order($1,$2,$3,null,null,$4)',[second,'stage',3,'Yard A']),/not valid/);
    await db.query('select transition_stock_order($1,$2,$3)',[second,'receive',3]);
    assert.equal((await db.query("select inventory_listing('WEST') items")).rows[0].items[0].stock,6);
  }finally{await db.close();}
});

test('supply roles enforce purchasing versus counted approval and block location retirement with open purchases',async()=>{
  const db=await database();try{
    await db.query('select save_inventory($1::jsonb)',[JSON.stringify({id:'ROLE-1',name:'Role-tested material',category:'Steel',unit:'ea',stock:0,price:12,reorder:5,location:'',supplier:'Vendor',location_id:'WEST'})]);
    const payload={requestKey:'00000000-0000-4000-8000-000000000041',supplier:'Vendor',locationId:'WEST',lines:[{partId:'ROLE-1',quantity:5}]};
    await db.exec("reset role;update profiles set role='purchasing';set role authenticated;");
    const id=(await db.query('select create_purchase_order($1::jsonb) id',[JSON.stringify(payload)])).rows[0].id;
    await db.query('select transition_purchase_order($1,$2,$3)',[id,'order',1]);
    const receipt={requestKey:'00000000-0000-4000-8000-000000000042',revision:2,lines:[{partId:'ROLE-1',accepted:5,rejected:0}]};
    await assert.rejects(()=>db.query('select approve_purchase_receipt($1,$2::jsonb)',[id,JSON.stringify(receipt)]));
    await db.exec("reset role;update profiles set role='receiving';set role authenticated;");
    await assert.rejects(()=>db.query('select create_purchase_order($1::jsonb)',[JSON.stringify({...payload,requestKey:'00000000-0000-4000-8000-000000000043'})]));
    assert.equal((await db.query("select inventory_listing('WEST') items")).rows[0].items[0].price,null);
    await db.exec("reset role;update profiles set role='admin';set role authenticated;");
    await assert.rejects(()=>db.query('select save_location($1::jsonb)',[JSON.stringify({id:'WEST',name:'West site',active:false})]),/incoming purchases/);
    await db.exec("reset role;update profiles set role='receiving';set role authenticated;");
    await db.query('select approve_purchase_receipt($1,$2::jsonb)',[id,JSON.stringify(receipt)]);
    assert.equal((await db.query("select inventory_listing('WEST') items")).rows[0].items[0].stock,5);
  }finally{await db.close();}
});

test('ordering board, partial counted receipts, rejects and special-order holds update stock exactly once',async()=>{
  const db=await database();try{
    const item={id:'BUY-1',name:'Purchased steel',category:'Steel',unit:'ea',stock:0,price:null,reorder:10,location:'',supplier:'Steel Vendor',location_id:'MAIN'};
    await db.query('select save_inventory($1::jsonb)',[JSON.stringify(item)]);
    const board=(await db.query("select supply_board('MAIN') items")).rows[0].items;assert.equal(board[0].suggested,10);
    const purchase=(await db.query('select create_purchase_order($1::jsonb) id',[JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000020',supplier:'Steel Vendor',locationId:'MAIN',lines:[{partId:item.id,quantity:10}]})])).rows[0].id;
    await db.query('select transition_purchase_order($1,$2,$3)',[purchase,'order',1]);
    assert.equal((await db.query("select supply_board('MAIN') items")).rows[0].items[0].suggested,0);
    const receipt={requestKey:'00000000-0000-4000-8000-000000000021',revision:2,deliveryReference:'DEL-1',lines:[{partId:item.id,accepted:6,rejected:2,bin:'Rack 4'}]};
    const approved=(await db.query('select approve_purchase_receipt($1,$2::jsonb) receipt',[purchase,JSON.stringify(receipt)])).rows[0].receipt;
    assert.equal(approved.accepted,6);assert.equal(approved.rejected,2);
    assert.equal((await db.query('select approve_purchase_receipt($1,$2::jsonb) receipt',[purchase,JSON.stringify(receipt)])).rows[0].receipt.alreadyApplied,true);
    assert.equal((await db.query("select inventory_listing('MAIN') items")).rows[0].items[0].stock,6);
    await assert.rejects(()=>db.query('select approve_purchase_receipt($1,$2::jsonb)',[purchase,JSON.stringify({...receipt,requestKey:'00000000-0000-4000-8000-000000000022',revision:3,lines:[{partId:item.id,accepted:5,rejected:0}]})]),/exceeds outstanding/);
    await db.query('select approve_purchase_receipt($1,$2::jsonb)',[purchase,JSON.stringify({...receipt,requestKey:'00000000-0000-4000-8000-000000000023',revision:3,lines:[{partId:item.id,accepted:4,rejected:0}]})]);
    assert.equal((await db.query("select * from stock_alerts where active")).rows.length,0);
    await db.exec('reset role');
    const customer=(await db.query("insert into customers(name,shipping_address)values('Special Customer','{\"line1\":\"Farm Road\"}')returning id")).rows[0].id;
    await db.exec('set role authenticated');
    const customerOrder=(await db.query('select create_stock_order($1::jsonb) id',[JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000030',kind:'customer',sourceLocation:'MAIN',customerId:customer,lines:[{partId:item.id,quantity:3}]})])).rows[0].id;
    const special=(await db.query('select create_purchase_order($1::jsonb) id',[JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000031',supplier:'Steel Vendor',locationId:'MAIN',linkedOrderId:customerOrder,lines:[{partId:item.id,quantity:3}]})])).rows[0].id;
    await db.query('select transition_purchase_order($1,$2,$3)',[special,'order',1]);
    await db.query('select approve_purchase_receipt($1,$2::jsonb)',[special,JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000032',revision:2,lines:[{partId:item.id,accepted:3,rejected:0}]})]);
    const balance=(await db.query("select inventory_listing('MAIN') items")).rows[0].items[0];assert.equal(balance.stock,13);assert.equal(balance.reserved,3);assert.equal(balance.available,10);
    assert.equal((await db.query('select status from stock_orders where id=$1',[customerOrder])).rows[0].status,'held');
    await db.query('select transition_stock_order($1,$2,$3)',[customerOrder,'cancel',3]);
    assert.equal((await db.query("select inventory_listing('MAIN') items")).rows[0].items[0].available,13);
  }finally{await db.close();}
});