import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { locationSchema,customerSchema,orderSchema,orderActions,logisticsRoles } from '../shared/operations.js';
import { registerSupply } from './supply.js';
import { supplyReadRoles,receivingRoles } from '../shared/purchasing.js';

export function registerOperations({app,db,allow,audit}) {
  for(const [table,column,definition] of [['users','location_id',"TEXT NOT NULL DEFAULT 'MAIN'"],['inventory','location',"TEXT NOT NULL DEFAULT ''"],['inventory','supplier',"TEXT NOT NULL DEFAULT ''"]]){
    if(!db.prepare(`PRAGMA table_info(${table})`).all().some(item=>item.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1);
    INSERT OR IGNORE INTO locations(id,name) VALUES('MAIN','Primary location');
    CREATE TABLE IF NOT EXISTS inventory_balances(part_id TEXT NOT NULL,location_id TEXT NOT NULL,stock REAL NOT NULL DEFAULT 0 CHECK(stock>=0),reserved REAL NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock),reorder REAL NOT NULL DEFAULT 0,bin TEXT NOT NULL DEFAULT '',PRIMARY KEY(part_id,location_id));
    CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stock_orders(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',source_location TEXT NOT NULL,destination_location TEXT,customer_id TEXT,shipping_address TEXT NOT NULL,reference TEXT NOT NULL,scheduled_date TEXT NOT NULL,carrier TEXT NOT NULL,tracking TEXT NOT NULL,notes TEXT NOT NULL,created_by INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stock_order_lines(order_id TEXT NOT NULL,part_id TEXT NOT NULL,quantity REAL NOT NULL CHECK(quantity>0),PRIMARY KEY(order_id,part_id));
    CREATE TABLE IF NOT EXISTS stock_movements(id INTEGER PRIMARY KEY,part_id TEXT NOT NULL,location_id TEXT NOT NULL,order_id TEXT,event TEXT NOT NULL,stock_delta REAL NOT NULL,reserved_delta REAL NOT NULL,actor INTEGER,created TEXT NOT NULL,note TEXT NOT NULL DEFAULT '');`);
  for(const [column,definition] of [['description',"TEXT NOT NULL DEFAULT ''"],['unit',"TEXT NOT NULL DEFAULT ''"]])if(!db.prepare('PRAGMA table_info(stock_order_lines)').all().some(item=>item.name===column))db.exec(`ALTER TABLE stock_order_lines ADD COLUMN ${column} ${definition}`);
  db.exec("UPDATE stock_order_lines SET description=(SELECT name FROM inventory WHERE id=part_id),unit=(SELECT unit FROM inventory WHERE id=part_id) WHERE description='' OR unit=''");
  if(!db.prepare("SELECT id FROM settings WHERE id='multi_location_initialized'").get()){
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec("INSERT INTO inventory_balances(part_id,location_id,stock,reorder,bin) SELECT id,'MAIN',stock,reorder,location FROM inventory;");
      db.prepare("INSERT INTO stock_movements(part_id,location_id,event,stock_delta,reserved_delta,created,note) SELECT part_id,location_id,'opening',stock,0,?,'Existing inventory preserved during location migration.' FROM inventory_balances").run(new Date().toISOString());
      db.prepare("INSERT INTO settings VALUES('multi_location_initialized','true')").run();db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  registerSupply({app,db,allow,audit});
  const activeLocation=id=>Boolean(db.prepare('SELECT id FROM locations WHERE id=? AND active=1').get(id));
  const stagedSql="coalesce((SELECT SUM(l.reserved_quantity)FROM stock_order_lines l JOIN stock_orders o ON o.id=l.order_id WHERE l.part_id=b.part_id AND o.source_location=b.location_id AND o.status='staged'),0)";
  const inventoryAt=(locationId='MAIN',flat=false)=>{
    if(locationId!=='all'&&!activeLocation(locationId))throw new Error('Choose an active inventory location.');
    if(locationId==='all'&&!flat)return db.prepare(`SELECT i.id,i.name,i.category,i.unit,i.price,i.supplier,SUM(b.stock) stock,SUM(b.reserved) reserved,SUM(${stagedSql}) staged,SUM(b.reserved-${stagedSql}) held,SUM(b.stock-b.reserved) available,SUM(b.reorder) reorder,'' location,'all' location_id FROM inventory i JOIN inventory_balances b ON b.part_id=i.id GROUP BY i.id ORDER BY i.id`).all();
    return db.prepare(`SELECT i.id,i.name,i.category,i.unit,i.price,i.supplier,b.stock,b.reserved,${stagedSql} staged,b.reserved-${stagedSql} held,b.stock-b.reserved available,b.reorder,b.bin location,b.location_id FROM inventory i JOIN inventory_balances b ON b.part_id=i.id ${locationId==='all'?'':'WHERE b.location_id=?'} ORDER BY i.id,b.location_id`).all(...(locationId==='all'?[]:[locationId]));
  };
  const saveItem=(item,actor=null)=>{
    const site=item.location_id||'MAIN';if(!activeLocation(site))throw new Error('Choose an active inventory location.');
    const before=db.prepare('SELECT * FROM inventory_balances WHERE part_id=? AND location_id=?').get(item.id,site);
    if(item.stock<(before?.reserved||0))throw new Error('Count cannot be lower than materials currently held for delivery.');
    const existing=db.prepare('SELECT unit FROM inventory WHERE id=?').get(item.id);
    if(existing&&existing.unit!==item.unit&&db.prepare('SELECT part_id FROM inventory_balances WHERE part_id=? AND stock>0').get(item.id))throw new Error('Cannot change units while stock exists.');
    db.prepare('INSERT INTO inventory(id,name,category,unit,stock,price,reorder,location,supplier) VALUES(?,?,?,?,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,unit=excluded.unit,price=excluded.price,supplier=excluded.supplier').run(item.id,item.name,item.category,item.unit,item.price,item.reorder,item.location,item.supplier);
    db.prepare('INSERT INTO inventory_balances(part_id,location_id,stock,reorder,bin) VALUES(?,?,?,?,?) ON CONFLICT(part_id,location_id) DO UPDATE SET stock=excluded.stock,reorder=excluded.reorder,bin=excluded.bin').run(item.id,site,item.stock,item.reorder,item.location);
    db.prepare('UPDATE inventory SET stock=(SELECT SUM(stock) FROM inventory_balances WHERE part_id=?) WHERE id=?').run(item.id,item.id);
    const delta=item.stock-(before?.stock||0);
    if(delta)db.prepare("INSERT INTO stock_movements(part_id,location_id,event,stock_delta,reserved_delta,actor,created,note) VALUES(?,?,'count-adjustment',?,0,?,?,'Manual count or reviewed inventory import.')").run(item.id,site,delta,actor,new Date().toISOString());
  };
  const customerRows=()=>db.prepare('SELECT * FROM customers ORDER BY updated DESC').all().map(row=>({...JSON.parse(row.data),id:row.id,revision:row.revision,updated:row.updated}));
  const shipmentRows=()=>db.prepare('SELECT * FROM stock_orders ORDER BY created DESC').all().map(order=>({...order,shipping_address:JSON.parse(order.shipping_address),customer_snapshot:JSON.parse(order.customer_snapshot||'{}'),customer_name:JSON.parse(order.customer_snapshot||'{}').name||customerRows().find(customer=>customer.id===order.customer_id)?.name||'',lines:db.prepare('SELECT part_id,quantity,reserved_quantity,description name,unit FROM stock_order_lines WHERE order_id=?').all(order.id)}));
  app.get('/api/locations',allow(),(req,res)=>res.json(db.prepare('SELECT * FROM locations ORDER BY name').all().map(item=>({...item,active:Boolean(item.active)}))));
  app.post('/api/locations',allow('admin'),(req,res)=>{
    const parsed=locationSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a valid location code, name, address, and phone.'});
    const data=parsed.data;
    if(!data.active&&(db.prepare('SELECT id FROM users WHERE location_id=? AND disabled=0').get(data.id)||db.prepare('SELECT part_id FROM inventory_balances WHERE location_id=? AND(stock>0 OR reserved>0)').get(data.id)||db.prepare("SELECT id FROM stock_orders WHERE status IN('draft','awaiting_materials','held','staged','dispatched') AND(source_location=? OR destination_location=?)").get(data.id,data.id)||db.prepare("SELECT id FROM purchase_orders WHERE location_id=? AND status IN('draft','ordered','partially_received')").get(data.id)))return res.status(409).json({error:'Move active employees, stock, open shipments, and incoming purchases before deactivating this location.'});
    db.prepare('INSERT INTO locations VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,phone=excluded.phone,active=excluded.active').run(data.id,data.name,data.address,data.phone,Number(data.active));audit(req,'location.save',{id:data.id,active:data.active});res.json({ok:true});
  });
  app.get('/api/customers',allow(...logisticsRoles),(req,res)=>res.json(customerRows()));
  app.post('/api/customers',allow(...logisticsRoles),(req,res)=>{
    const parsed=customerSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0].message});
    const data=parsed.data;const id=data.id||randomUUID();const now=new Date().toISOString();
    if(data.id){const result=db.prepare('UPDATE customers SET data=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(JSON.stringify(data),now,id,data.revision||0);if(!result.changes)return res.status(409).json({error:'Customer changed. Refresh before saving.'});}
    else db.prepare('INSERT INTO customers(id,data,updated) VALUES(?,?,?)').run(id,JSON.stringify(data),now);
    audit(req,'customer.save',{id});res.json({id});
  });
  app.get('/api/shipments',allow(...supplyReadRoles),(req,res)=>res.json(shipmentRows()));
  app.post('/api/shipments',allow(...logisticsRoles),(req,res)=>{
    const parsed=orderSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0].message});
    const data=parsed.data;db.exec('BEGIN IMMEDIATE');
    try{
      const previous=db.prepare('SELECT * FROM stock_orders WHERE request_key=?').get(data.requestKey);
      if(previous){if(previous.created_by!==req.user.id||previous.payload!==JSON.stringify(data))throw new Error('Request key already used for a different shipment.');db.exec('COMMIT');return res.json({id:previous.id});}
      if(!activeLocation(data.sourceLocation)||data.kind==='transfer'&&!activeLocation(data.destinationLocation))throw new Error('Choose active shipping and receiving locations.');
      const customer=data.kind==='customer'?customerRows().find(customer=>customer.id===data.customerId&&customer.active):null;
      const shipping=data.kind==='customer'?(data.shippingAddress||customer?.shippingAddress):{};
      if(data.kind==='customer'&&(!customer||!shipping?.line1))throw new Error('Choose an active customer with a shipping address.');
      for(const line of data.lines)if(!db.prepare('SELECT part_id FROM inventory_balances WHERE part_id=? AND location_id=?').get(line.partId,data.sourceLocation))throw new Error('A selected part is not stocked at this location.');
      const id=randomUUID();const now=new Date().toISOString();
      db.prepare('INSERT INTO stock_orders(id,request_key,payload,kind,source_location,destination_location,customer_id,shipping_address,reference,scheduled_date,carrier,tracking,notes,created_by,created,updated,customer_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,data.requestKey,JSON.stringify(data),data.kind,data.sourceLocation,data.kind==='transfer'?data.destinationLocation:null,data.kind==='customer'?data.customerId:null,JSON.stringify(shipping),data.reference,data.scheduledDate,data.carrier,data.tracking,data.notes,req.user.id,now,now,JSON.stringify(customer?{name:customer.name,accountNumber:customer.accountNumber,contactName:customer.contactName,email:customer.email,phone:customer.phone,shippingInstructions:customer.shippingInstructions}:{}));
      const lineInsert=db.prepare('INSERT INTO stock_order_lines(order_id,part_id,quantity,description,unit) SELECT ?,?,?,name,unit FROM inventory WHERE id=?');for(const line of data.lines)lineInsert.run(id,line.partId,line.quantity,line.partId);
      audit(req,'shipment.create',{id,kind:data.kind});db.exec('COMMIT');res.json({id});
    }catch(error){db.exec('ROLLBACK');res.status(409).json({error:error.message});}
  });
  app.post('/api/shipments/:id/action',allow(...supplyReadRoles),(req,res)=>{
    const parsed=z.object({action:z.enum(orderActions),revision:z.number().int().positive(),carrier:z.string().max(100).optional(),tracking:z.string().max(200).optional(),yardArea:z.string().trim().max(160).optional()}).safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Choose a valid shipment action.'});
    const data=parsed.data;db.exec('BEGIN IMMEDIATE');
    try{
      const permitted=['stage','unstage','receive'].includes(data.action)?receivingRoles:logisticsRoles;if(!permitted.includes(req.user.role)){db.exec('ROLLBACK');return res.status(403).json({error:'Your role does not permit this action.'});}
      const order=db.prepare('SELECT * FROM stock_orders WHERE id=?').get(req.params.id);if(!order)throw new Error('Shipment not found.');if(order.revision!==data.revision)throw new Error('Shipment changed. Refresh before applying this action.');
      let next;
      if(data.action==='hold'&&['draft','awaiting_materials'].includes(order.status))next='held';else if(data.action==='stage'&&order.status==='held'){if(!data.yardArea)throw new Error('Enter the yard staging area.');next='staged';}else if(data.action==='unstage'&&order.status==='staged')next='held';else if(data.action==='dispatch'&&['held','staged'].includes(order.status))next='dispatched';else if(data.action==='cancel'&&['draft','awaiting_materials','held','staged'].includes(order.status))next='cancelled';else if(data.action==='receive'&&order.status==='dispatched'&&order.kind==='transfer')next='received';else if(data.action==='deliver'&&order.status==='dispatched'&&order.kind==='customer')next='delivered';else throw new Error('This action is not valid for the current shipment state.');
      const lines=db.prepare('SELECT * FROM stock_order_lines WHERE order_id=? ORDER BY part_id').all(order.id);
      for(const line of lines){
        const site=data.action==='receive'?order.destination_location:order.source_location;
        if(data.action==='receive'){if(!activeLocation(site))throw new Error('Receiving location is inactive.');db.prepare('INSERT OR IGNORE INTO inventory_balances(part_id,location_id) VALUES(?,?)').run(line.part_id,site);}
        const balance=db.prepare('SELECT * FROM inventory_balances WHERE part_id=? AND location_id=?').get(line.part_id,site);let delta=0;let held=0;
        if(data.action==='hold'){const needed=line.quantity-line.reserved_quantity;if(balance.stock-balance.reserved<needed)throw new Error(`Insufficient available stock for ${line.part_id}. No materials were reserved.`);held=needed;}
        if(data.action==='dispatch'){if(line.reserved_quantity!==line.quantity)throw new Error('All materials must be held before dispatch.');delta=-line.quantity;held=-line.reserved_quantity;}
        if(data.action==='cancel')held=-line.reserved_quantity;
        if(data.action==='receive')delta=line.quantity;
        if(delta||held){db.prepare('UPDATE inventory_balances SET stock=stock+?,reserved=reserved+? WHERE part_id=? AND location_id=?').run(delta,held,line.part_id,site);db.prepare('UPDATE stock_order_lines SET reserved_quantity=reserved_quantity+? WHERE order_id=? AND part_id=?').run(held,order.id,line.part_id);db.prepare('UPDATE inventory SET stock=(SELECT SUM(stock) FROM inventory_balances WHERE part_id=?) WHERE id=?').run(line.part_id,line.part_id);}if(delta||held||['stage','unstage'].includes(data.action))db.prepare('INSERT INTO stock_movements(part_id,location_id,order_id,event,stock_delta,reserved_delta,actor,created,note) VALUES(?,?,?,?,?,?,?,?,?)').run(line.part_id,site,order.id,data.action,delta,held,req.user.id,new Date().toISOString(),data.action==='stage'?data.yardArea:'');
      }
      db.prepare('UPDATE stock_orders SET status=?,revision=revision+1,updated=?,carrier=?,tracking=?,yard_area=?,staged_at=? WHERE id=?').run(next,new Date().toISOString(),data.carrier??order.carrier,data.tracking??order.tracking,data.action==='stage'?data.yardArea:data.action==='unstage'?'':order.yard_area,data.action==='stage'?new Date().toISOString():data.action==='unstage'?null:order.staged_at,order.id);audit(req,`shipment.${data.action}`,{id:order.id,from:order.status,to:next});db.exec('COMMIT');res.json({id:order.id,status:next,revision:order.revision+1});
    }catch(error){db.exec('ROLLBACK');res.status(409).json({error:error.message});}
  });
  app.get('/api/stock-movements',allow(...supplyReadRoles),(req,res)=>res.json(db.prepare('SELECT * FROM stock_movements ORDER BY id DESC LIMIT 500').all()));
  return {inventoryAt,saveItem,activeLocation};
}