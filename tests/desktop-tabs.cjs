const assert = require('node:assert/strict')

module.exports = async ({page}) => {
  // Start with one Home tab regardless of what previous smoke tests opened.
  const bar = page.locator('.wt-tabbar')
  await bar.click({button:'right', position:{x:18,y:18}})
  await page.getByRole('menuitem',{name:'Close all tabs'}).click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  assert.equal(await page.getByRole('tab').count(),1)

  const plus=page.getByRole('button',{name:'New tab'})
  await plus.click()
  await page.locator('a[href="#/music"]:visible').first().click()
  await page.getByRole('heading',{name:'YouTube Music',exact:true}).waitFor()
  await plus.click()
  await page.locator('a[href="#/account"]:visible').first().click()
  await page.getByRole('heading',{name:'Account & privacy'}).waitFor()

  const order=()=>page.locator('[role="tablist"] > [data-tab-id] > button[role="tab"]').allTextContents().then(labels=>labels.map(s=>s.trim()))
  assert.deepEqual(await order(),['Home','Music','Account'])

  // Physical drag-and-drop should reorder the actual tab data, not just DOM.
  const items=page.locator('[role="tablist"] > [data-tab-id]')
  await items.nth(2).dragTo(items.nth(0))
  assert.deepEqual(await order(),['Account','Home','Music'])
  console.log('PASS: dragging a tab changes its real order')

  // Right-clicking a tab exposes a keyboard/mouse-accessible reorder fallback.
  await page.getByRole('tab',{name:'Home',exact:true}).click({button:'right'})
  await page.getByRole('menuitem',{name:'Move tab right'}).click()
  assert.deepEqual(await order(),['Account','Music','Home'])
  await page.getByRole('tab',{name:'Music',exact:true}).click()
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('loktube.tabs.v1')))
  assert.deepEqual(before.tabs.map(t=>t.entries[t.index]),['/account','/music','/'])
  assert.equal(before.tabs.find(t=>t.id===before.activeId).entries[0],'/music')

  // Reload clears React state entirely, exactly like starting a fresh window.
  await page.reload()
  await page.getByRole('heading',{name:'YouTube Music',exact:true}).waitFor()
  assert.deepEqual(await order(),['Account','Music','Home'])
  assert.equal(await page.getByRole('tab',{name:'Music',exact:true}).getAttribute('aria-selected'),'true')
  console.log('PASS: renderer restart restores all tabs, active selection and reordered positions')

  // Right-clicking empty space on the row must offer the same Close all command.
  const width=(await bar.boundingBox()).width
  await bar.click({button:'right',position:{x:width-8,y:18}})
  await page.getByRole('menuitem',{name:'Close all tabs'}).click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  assert.deepEqual(await order(),['Home'])
  await page.reload()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  assert.deepEqual(await order(),['Home'])
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('loktube.tabs.v1')))).tabs.length,1)
  console.log('PASS: close-all from empty tab strip resets and persists clean Home session')
}
