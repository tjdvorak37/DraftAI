import { z } from 'zod';
import { purchaseSchema,receiptSchema,purchasingRoles,receivingRoles,supplyReadRoles } from '../../../shared/purchasing.js';

export async function routeSupply({path,method,body,service,user,profile,permit,checked,failure,query}){
  if(path==='/ordering-board'&&method==='GET'){permit(supplyReadRoles);return {data:checked(await user.rpc('supply_board',{p_location:query.get('location')||profile.location_id}))};}
  let match=path.match(/^\/stock-alerts\/([a-f0-9-]+)\/acknowledge$/i);
  if(match&&method==='POST'){permit(purchasingRoles);const id=z.uuid().parse(match[1]);const episode=z.number().int().positive().parse(body.episode);checked(await user.rpc('acknowledge_stock_alert',{alert_id:id,expected_episode:episode}));return {data:{ok:true}};}
  if(path==='/purchases'&&method==='GET'){permit(supplyReadRoles);const orders=[];for(let offset=0;;offset+=500){const page=checked(await user.from('purchase_orders').select('*,purchase_order_lines(*),purchase_receipts(*,purchase_receipt_lines(*))').order('created',{ascending:false}).range(offset,offset+499));orders.push(...page);if(page.length<500)break;}return {data:orders.map(order=>({...order,lines:order.purchase_order_lines,receipts:order.purchase_receipts.map(receipt=>({...receipt,lines:receipt.purchase_receipt_lines}))}))};}
  if(path==='/purchases'&&method==='POST'){permit(purchasingRoles);const payload=purchaseSchema.parse(body);const id=checked(await user.rpc('create_purchase_order',{payload}));return {data:{id}};}
  match=path.match(/^\/purchases\/([a-f0-9-]+)\/(action|receive)$/i);
  if(match&&method==='POST'){const id=z.uuid().parse(match[1]);let result;if(match[2]==='action'){permit(purchasingRoles);const data=z.object({action:z.enum(['order','cancel']),revision:z.number().int().positive()}).parse(body);result=await user.rpc('transition_purchase_order',{purchase_id:id,action:data.action,expected_revision:data.revision});}else{permit(receivingRoles);result=await user.rpc('approve_purchase_receipt',{purchase_id:id,payload:receiptSchema.parse(body)});}if(result.error)throw failure(result.error.message,409);return {data:result.data};}
  return null;
}