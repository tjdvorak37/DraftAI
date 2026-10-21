import { z } from 'zod';
import { locationSchema, customerSchema, orderSchema, orderActions, logisticsRoles } from '../../../shared/operations.js';

export async function routeOperations({ path, method, body, service, user, identity, profile, permit, checked, audit, failure }) {
  if (path === '/locations' && method === 'GET') return { data: checked(await service.from('locations').select('*').order('name')) };
  if (path === '/locations' && method === 'POST') {
    permit(['admin']); const location = locationSchema.parse(body);
    const result=await user.rpc('save_location',{payload:location});if(result.error)throw failure(result.error.message,409);return {data:{ok:true}};
  }
  if (path === '/customers' && method === 'GET') {
    permit(logisticsRoles); const customers=[];
    for(let offset=0;;offset+=1000){const page=checked(await user.from('customers').select('*').order('name').range(offset,offset+999));customers.push(...page);if(page.length<1000)break;}
    return {data:customers.map(customer=>({...customer,accountNumber:customer.account_number,contactName:customer.contact_name,billingAddress:customer.billing_address,shippingAddress:customer.shipping_address,shippingInstructions:customer.shipping_instructions}))};
  }
  if(path==='/customers' && method==='POST'){
    permit(logisticsRoles);const data=customerSchema.parse(body);
    const values={name:data.name,account_number:data.accountNumber,contact_name:data.contactName,email:data.email,phone:data.phone,website:data.website,billing_address:data.billingAddress,shipping_address:data.shippingAddress,shipping_instructions:data.shippingInstructions,contacts:data.contacts,notes:data.notes,active:data.active,updated:new Date().toISOString()};
    let saved;
    if(data.id){
      if(!data.revision)throw failure('Refresh this customer before saving.',409);
      saved=checked(await service.from('customers').update({...values,revision:data.revision+1}).eq('id',data.id).eq('revision',data.revision).select('id').maybeSingle());
      if(!saved)throw failure('Customer changed. Refresh before saving.',409);
    }else saved=checked(await service.from('customers').insert(values).select('id').single());
    await audit('customer.save',{id:saved.id});return {data:saved};
  }
  if(path==='/shipments' && method==='GET'){
    permit(logisticsRoles);const orders=[];
    for(let offset=0;;offset+=500){const page=checked(await user.from('stock_orders').select('*,stock_order_lines(part_id,quantity,description,unit),customers(name)').order('created',{ascending:false}).range(offset,offset+499));orders.push(...page);if(page.length<500)break;}
    return {data:orders.map(order=>({...order,customer_name:order.customers?.name||'',lines:order.stock_order_lines.map(line=>({...line,name:line.description}))}))};
  }
  if(path==='/shipments' && method==='POST'){
    permit(logisticsRoles);const payload=orderSchema.parse(body);const id=checked(await user.rpc('create_stock_order',{payload}));return {data:{id}};
  }
  let match=path.match(/^\/shipments\/([a-f0-9-]+)\/action$/i);
  if(match && method==='POST'){
    permit(logisticsRoles);const id=z.uuid().parse(match[1]);const data=z.object({action:z.enum(orderActions),revision:z.number().int().positive(),carrier:z.string().max(100).optional(),tracking:z.string().max(200).optional()}).parse(body);
    const result=await user.rpc('transition_stock_order',{order_id:id,action:data.action,expected_revision:data.revision,carrier_value:data.carrier??null,tracking_value:data.tracking??null});
    if(result.error)throw failure(result.error.message,409);return {data:result.data};
  }
  if(path==='/stock-movements' && method==='GET'){
    permit(logisticsRoles);return {data:checked(await user.from('stock_movements').select('*').order('id',{ascending:false}).limit(500))};
  }
  return null;
}