const assert=require('node:assert/strict')
module.exports=async({app,page})=>{
  await page.waitForFunction(()=>document.querySelector('.wt-watch-player-slot video')?.readyState>=2)
  await page.evaluate(()=>{
    window.__pipVideo=document.querySelector('.wt-watch-player-slot video')
    window.__pipVideo.pause()
    window.__pipVideo.currentTime=4
  })
  const requested=await app.evaluate(()=>globalThis.__featurePlaybackRequests.length)
  const enter=async()=>{
    await page.locator('.shaka-pip-button:visible').first().click({force:true})
    await page.waitForFunction(()=>document.pictureInPictureElement===window.__pipVideo)
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
    await page.getByRole('button',{name:'Return to video',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.pictureInPictureElement===window.__pipVideo),true,'PiP must stay open after navigating Home')
  }
  const returned=async()=>{
    await page.waitForFunction(()=>!document.pictureInPictureElement && document.querySelector('.wt-watch-player-slot video')===window.__pipVideo)
    assert.equal(await page.evaluate(()=>Math.abs(window.__pipVideo.currentTime-4)<0.1),true)
    assert.equal(await app.evaluate(()=>globalThis.__featurePlaybackRequests.length),requested,'returning from PiP must not reload media')
  }
  await enter()
  await page.locator('.wt-player-bar:visible').getByRole('button',{name:/Playback fixture/}).click()
  await returned()
  await enter()
  await page.getByRole('button',{name:'Return to video',exact:true}).click()
  await returned()
  await enter()
  // Native PiP's return/close control produces this same browser exit event.
  await page.evaluate(()=>document.exitPictureInPicture())
  await returned()
  await enter()
  await page.getByRole('button',{name:'New tab',exact:true}).click()
  await page.evaluate(()=>document.exitPictureInPicture())
  await returned()
  await page.locator('a[href="#/"]:visible').first().click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  await page.getByRole('button',{name:'Return to video',exact:true}).click()
  await returned()
  console.log('PASS: real native PiP opens Home; footer, return button, native exit and cross-tab return restore the video with PiP off; inline mini return needs one click')
}
