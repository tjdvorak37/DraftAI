import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function signIn(page){const response=await page.request.post('/api/auth/login',{data:{email:'studio@example.test',password:'isolated-test-password'}});expect(response.ok()).toBe(true);}

test('concrete floor requests and real selected components can be edited, undone, exported, and reopened',async({page})=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page);await page.goto('/');
  await page.getByRole('textbox',{name:'Describe a design change',exact:true}).fill('add a concrete floor');
  await page.getByRole('button',{name:'Send design request',exact:true}).click();
  await expect(page.locator('.proposal')).toContainText('6 in slab');
  await expect(page.locator('.proposal')).toContainText('draft thickness');
  await page.getByRole('button',{name:'Apply to building',exact:true}).click();
  await expect(page.locator('.bom-table tbody tr').filter({hasText:'Concrete floor slab'})).toContainText('112');
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const canvas=await page.locator('canvas').boundingBox();
  let selected=false;
  const hits=[];
  for(const vertical of [0.82,0.87,0.76,0.91]){
    for(const horizontal of [0.46,0.54,0.42,0.58]){
      await page.mouse.click(canvas.x+canvas.width*horizontal,canvas.y+canvas.height*vertical);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const label=page.locator('.selection-popover strong');
      if(await label.count()){const text=await label.textContent();hits.push(text);if(/Concrete floor slab/.test(text)){selected=true;break;}}
    }
    if(selected)break;
  }
  expect(selected,`The real slab should be selectable in the canvas; hits: ${hits.join(', ')}`).toBe(true);
  await page.getByRole('button',{name:'Edit properties',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Component properties',exact:true})).toBeVisible();
  await page.getByLabel('Component Slab thickness',{exact:true}).fill('4');
  await page.getByRole('button',{name:'Apply component changes',exact:true}).click();
  await expect(page.locator('.bom-table tbody tr').filter({hasText:'Concrete floor slab'})).toContainText('74.667');
  await page.getByRole('button',{name:'Undo design change',exact:true}).click();
  await expect(page.locator('.bom-table tbody tr').filter({hasText:'Concrete floor slab'})).toContainText('112');
  await page.getByRole('button',{name:'Redo design change',exact:true}).click();
  await expect(page.locator('.bom-table tbody tr').filter({hasText:'Concrete floor slab'})).toContainText('74.667');
  await page.getByRole('button',{name:'Components',exact:true}).click();
  await page.getByRole('button',{name:'Edit Building frame',exact:true}).click();
  await page.getByLabel('Component Bay spacing',{exact:true}).fill('16');
  await page.getByRole('button',{name:'Apply component changes',exact:true}).click();
  await expect(page.locator('.assistant-initial')).toContainText('7 galvanized frames');
  await page.getByRole('button',{name:'Components',exact:true}).click();
  await page.getByRole('button',{name:'Edit Garage door',exact:true}).click();
  await page.getByLabel('Component Door width',{exact:true}).fill('24');
  await page.getByRole('button',{name:'Apply component changes',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Door width',exact:true})).toHaveValue('24');
  await page.getByRole('button',{name:'3D model',exact:true}).click();
  await page.screenshot({path:'/tmp/accusteel-editable-floor.png',fullPage:true});
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:/Draft Studio project/}).click();
  const downloaded=await downloading;const project=JSON.parse(await readFile(await downloaded.path(),'utf8'));
  expect(project.building.floor).toEqual({enabled:true,thickness:4,wastePercent:5});
  await page.reload();await page.getByRole('button',{name:'Components',exact:true}).click();
  await page.getByRole('button',{name:'Edit Concrete floor slab',exact:true}).click();
  await expect(page.getByLabel('Component Slab thickness',{exact:true})).toHaveValue('4');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/accusteel-component-editor-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Assistant',exact:true}).click();
  await page.getByRole('textbox',{name:'Describe a design change',exact:true}).fill('remove concrete floor');
  await page.getByRole('button',{name:'Send design request',exact:true}).click();
  await page.getByRole('button',{name:'Apply to building',exact:true}).click();
  await page.getByRole('button',{name:'Model',exact:true}).click();
  await expect(page.locator('.bom-table tbody tr').filter({hasText:'Concrete floor slab'})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('read-only design sessions can inspect components but cannot apply property edits',async({page})=>{
  await signIn(page);
  await page.route('**/api/auth',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,user:{...data.user,role:'viewer'}}});});
  await page.goto('/');await page.getByRole('button',{name:'Components',exact:true}).click();
  await page.getByRole('button',{name:'Edit Concrete floor slab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Component properties · read only',exact:true})).toBeVisible();
  await expect(page.getByLabel('Component Slab thickness',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Apply component changes',exact:true})).toBeDisabled();
});