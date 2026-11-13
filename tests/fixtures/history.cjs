const ids={regular:'jNQXAC9IVRw',short:'short000002',lockup:'video000002',reel:'short000003',older:'video000004'}
const feedback=(id)=>`synthetic-history-remove-${id}`
const endpoint=(id)=>({feedbackEndpoint:{feedbackToken:feedback(id)}})
const button=(id)=>({buttonRenderer:{icon:{iconType:'CLOSE'},serviceEndpoint:endpoint(id)}})
function sheet(id){
  const item={title:{content:'Remove from watch history'},rendererContext:{commandContext:{onTap:{innertubeCommand:endpoint(id)}}}}
  const listViewModel={listItems:[{listItemViewModel:item}]}
  const sheetViewModel={content:{listViewModel}}
  return {innertubeCommand:{showSheetCommand:{panelLoadingStrategy:{inlineContent:{sheetViewModel}}}}}
}
function regular(id,title){return {videoRenderer:{videoId:id,title:{simpleText:title},ownerText:{runs:[{text:'Fixture creator'}]},thumbnail:{thumbnails:[]},lengthText:{simpleText:'0:19'},menu:{menuRenderer:{topLevelButtons:[button(id)]}}}}}
function short(){return {shortsLockupViewModel:{onTap:{innertubeCommand:{reelWatchEndpoint:{videoId:ids.short}}},thumbnail:{sources:[]},overlayMetadata:{primaryText:{content:'History Short fixture'}},menuOnTap:sheet(ids.short)}}}
function lockup(){return {lockupViewModel:{contentId:ids.lockup,contentType:'LOCKUP_CONTENT_TYPE_VIDEO',metadata:{lockupMetadataViewModel:{title:{content:'History lockup fixture'},menuButton:{onTap:sheet(ids.lockup)}}}}}}
function reel(){return {reelItemRenderer:{videoId:ids.reel,headline:{simpleText:'History reel fixture'},thumbnail:{thumbnails:[]},menu:{menuRenderer:{topLevelButtons:[button(ids.reel)]}}}}}
function page(removed=[],more=false){
  if(more)return {onResponseReceivedActions:[{appendContinuationItemsAction:{continuationItems:[short(),regular(ids.older,'Older history fixture')]}}]}
  const ordered=[[ids.regular,regular(ids.regular,'Remote history fixture')],[ids.short,short()],[ids.lockup,lockup()],[ids.reel,reel()]]
  const contents=ordered.filter(([id])=>!removed.includes(id)).map(([,item])=>item)
  contents.push({continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'fixture-history-next'}}}})
  return {contents:{sectionListRenderer:{contents:[{itemSectionRenderer:{header:{itemSectionHeaderRenderer:{title:{simpleText:'Today'}}},contents}}]}}}
}
module.exports={ids,feedback,page}
