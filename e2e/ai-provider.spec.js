import { test,expect } from '@playwright/test';

test('design commands stay local while provider selection is under review',async({page})=>{
  const remoteRequests=[];
  page.on('request',request=>{if(request.url().includes('/ai/design')||request.url().includes('api.openai.com'))remoteRequests.push(request.url());});
  const login=await page.request.post('/api/auth/login',{data:{email:'studio@example.test',password:'isolated-test-password'}});
  expect(login.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button',{name:'Admin',exact:true}).click();
  await page.getByRole('tab',{name:'Integrations',exact:true}).click();
  await expect(page.getByRole('heading',{name:'AI providers',exact:true})).toBeVisible();
  await expect(page.getByText('Provider selection is intentionally open',{exact:true})).toBeVisible();
  await expect(page.getByText('No external AI provider is connected.',{exact:false})).toBeVisible();
  await expect(page.getByLabel('API key',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Design',exact:true}).click();
  await expect(page.locator('.assistant-status')).toContainText('LOCAL COMMANDS');
  await expect(page.locator('.assistant-composer')).toContainText('Local dimension commands');
  await page.getByRole('textbox',{name:'Describe a design change'}).fill('Make it 80 ft wide');
  await page.getByRole('button',{name:'Send design request'}).click();
  await page.getByRole('button',{name:'Apply to building'}).click();
  await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('80');
  expect(remoteRequests).toEqual([]);
});