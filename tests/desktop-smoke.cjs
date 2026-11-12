const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, readFile, rm, readdir } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

;(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worldtube-smoke-'))
  const cookies = join(directory, 'cookies.txt')
  await writeFile(cookies, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSAPISID\tsynthetic-test-only\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tsynthetic-test-only\n')
  const executablePath=process.env.WORLDTUBE_SMOKE_APP
  const app = await electron.launch({executablePath,args:['--no-sandbox','--disable-gpu',...(!executablePath?['.']:[])], cwd:process.cwd(),
    env:{...process.env, DISPLAY:process.env.DISPLAY || ':99', XDG_CONFIG_HOME:directory}, timeout:30_000})
  const errors=[]
  app.process().stdout.on('data', (data)=>{ if(process.env.SMOKE_VERBOSE) process.stdout.write(data) })
  app.process().stderr.on('data', (data)=>{ if(process.env.SMOKE_VERBOSE) process.stderr.write(data) })
  try {
    const page=await app.firstWindow()
    page.on('pageerror',error=>errors.push(error.message))
    await page.getByRole('link',{name:'YouTube account',exact:true}).waitFor({timeout:20_000})
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).signedIn,false)
    assert.equal(await page.getByText('Create local user',{exact:true}).count(),0)
    await page.getByRole('link',{name:'YouTube account',exact:true}).click()
    await page.getByRole('heading',{name:'Account & privacy'}).waitFor()
    assert.equal((await page.evaluate(()=>window.api.getProtection())).enabled,true)
    assert.equal(await page.evaluate(async()=>{try{await fetch('https://googleads.g.doubleclick.net/pagead/id');return false}catch{return true}}),true)
    assert.ok((await page.evaluate(()=>window.api.getProtection())).blocked>=1)
    console.log('PASS: desktop boot, guest library, account UI and real request blocking')

    // Synthetic server fixtures exercise the real IPC, cookie parser,
    // InnerTube parser and library selection without a Google credential.
    await app.evaluate(({net,dialog},cookies)=>{
      globalThis.__smokeOriginalFetch=net.fetch
      globalThis.__smokeAuthenticated=false
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[cookies]})
      net.fetch=async(input,init)=>{
        const request=new Request(input,init)
        const url=new URL(request.url)
        const json=(data)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})
        const video={videoRenderer:{videoId:'jNQXAC9IVRw',title:{simpleText:'Remote history fixture'},
          thumbnail:{thumbnails:[{url:'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'}]},
          ownerText:{runs:[{text:'Fixture creator'}]},lengthText:{simpleText:'0:19'},viewCountText:{simpleText:'1 view'}}}
        if(url.pathname==='/youtubei/v1/account/accounts_list') {
          globalThis.__smokeAuthenticated=request.headers.get('cookie')?.includes('SAPISID=synthetic-test-only') && request.headers.get('authorization')?.startsWith('SAPISIDHASH ')
          return json({actions:[{accountSectionListRenderer:{contents:[{accountItemSectionRenderer:{contents:[{accountItem:{
            accountName:{simpleText:'Fixture YouTube account'},isSelected:true,hasChannel:true,
            channelHandle:{simpleText:'@worldtube-fixture'},accountByline:{simpleText:'fixture@example.test'},
            serviceEndpoint:{selectActiveIdentityEndpoint:{supportedTokens:[]}}}}]}}]}}]})
        }
        if(url.pathname==='/youtubei/v1/browse') {
          const body=JSON.parse(await request.text())
          const contents=body.browseId==='FEhistory' ? [video] : body.browseId==='FEchannels' ? [{channelRenderer:{channelId:'UCfixture',title:{simpleText:'Fixture subscription'},thumbnail:{thumbnails:[]}}}] : []
          return json({contents:{sectionListRenderer:{contents:[{itemSectionRenderer:{contents}}]}}})
        }
        if(url.pathname==='/youtubei/v1/subscription/subscribe' || url.pathname==='/youtubei/v1/subscription/unsubscribe') return json({})
        if(url.pathname==='/api/stats/watchtime' || url.pathname==='/api/stats/playback') return new Response(null,{status:204})
        if(url.pathname==='/youtubei/v1/config') return json({})
        if(url.hostname==='easylist.to') return globalThis.__smokeOriginalFetch(input,init)
        return json({})
      }
    }, cookies)
    await Promise.all([
      page.waitForEvent('domcontentloaded',{timeout:15_000}),
      page.getByRole('button',{name:'Import YouTube cookies.txt',exact:true}).click({noWaitAfter:true})
    ])
    await page.getByText('Connected to your YouTube account',{exact:true}).waitFor({timeout:15_000})
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).name,'Fixture YouTube account')
    assert.equal(await app.evaluate(()=>globalThis.__smokeAuthenticated),true)
    const profile=await page.evaluate(()=>window.api.getSessionState())
    assert.equal(profile.activeUser.name,'Fixture YouTube account')
    const database=await readFile(profile.dataPath,'utf8')
    assert.equal(database.includes('synthetic-test-only'),false)
    const session=await page.evaluate(()=>window.api.getYoutubeAccount())
    if(!session.persistent) assert.equal((await readdir(join(profile.dataPath,'..'))).includes('youtube-session.enc'),false)
    const history=await page.evaluate(()=>window.api.getYoutubeHistory())
    assert.equal(history.videos[0].title,'Remote history fixture')
    assert.equal((await page.evaluate(()=>window.api.listSubscriptions()))[0].channelName,'Fixture subscription')
    assert.equal((await page.evaluate(()=>window.api.getHomeFeed())).ok,true)
    await page.screenshot({path:'.cache/account-connected.png',fullPage:true})
    console.log('PASS: cookie import, authenticated headers, account identity, remote history/subscriptions and secret-free library')

    // A second account must receive its own local library.
    const firstProfile=profile.activeProfileId
    await app.evaluate(()=>{
      const original=globalThis.__smokeOriginalFetch
      const { net }=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')
      const fixture=net.fetch
      net.fetch=async(input,init)=>{
        const response=await fixture(input,init)
        const url=new URL(typeof input==='string'?input:input.url)
        if(url.pathname!=='/youtubei/v1/account/accounts_list') return response
        return new Response((await response.text()).replaceAll('@worldtube-fixture','@second-fixture').replaceAll('Fixture YouTube account','Second YouTube account'),{headers:{'content-type':'application/json'}})
      }
    })
    await page.evaluate(()=>window.api.importYoutubeCookies())
    const secondProfile=await page.evaluate(()=>window.api.getSessionState())
    assert.notEqual(secondProfile.activeProfileId,firstProfile)
    await page.evaluate(()=>window.api.signOutYoutube())
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).signedIn,false)
    assert.equal((await page.evaluate(()=>window.api.getSessionState())).activeUser.name,'Guest')
    console.log('PASS: account library isolation and sign-out')

    if(process.env.WORLDTUBE_SMOKE_FIREFOX) {
      await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},resolve(process.env.WORLDTUBE_SMOKE_FIREFOX))
      await page.reload()
      await page.getByRole('link',{name:'YouTube account',exact:true}).click()
      await page.getByRole('button',{name:'Sign in with Firefox',exact:true}).click()
      await page.getByRole('button',{name:'Cancel sign-in',exact:true}).waitFor()
      const profileDirectory=join(profile.dataPath,'..','browser-signin')
      const launched=await app.evaluate(async(_electron,directory)=>{
        const fs=process.getBuiltinModule('node:fs')
        const path=process.getBuiltinModule('node:path')
        for(let i=0;i<100;i++) {
          try {
            if(fs.readdirSync(directory).some((name)=>fs.existsSync(path.join(directory,name,'cookies.sqlite')))) return true
          } catch {}
          await new Promise(resolve=>setTimeout(resolve,100))
        }
        return false
      },profileDirectory)
      assert.equal(launched,true,'Firefox must actually launch and create its cookie database before cancellation')
      await page.getByRole('button',{name:'Cancel sign-in',exact:true}).click()
      await page.getByRole('button',{name:'Sign in with Firefox',exact:true}).waitFor({state:'visible'})
      // Finish cancellation before checking temporary-profile cleanup.
      await page.waitForFunction(()=>!document.body.textContent.includes('Waiting for Firefox'))
      assert.deepEqual(await readdir(profileDirectory),[])
      console.log('PASS: real Firefox launch, cancel and temporary profile cleanup')
    }
    assert.deepEqual(errors,[])
    console.log('Desktop smoke tests passed.')
  } finally {
    await app.close()
    await rm(directory,{recursive:true,force:true})
  }
})().catch(error=>{console.error(error);process.exitCode=1})
