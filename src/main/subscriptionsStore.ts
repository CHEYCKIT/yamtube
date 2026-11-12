import type { Subscription } from '../shared/ipc'
import { addActiveSubscription, listActiveSubscriptions, removeActiveSubscription } from './localDb'
import { getAccountClient, hasYoutubeAccount } from './youtubeAccount'

export async function listSubscriptions(): Promise<Subscription[]> {
  if (hasYoutubeAccount()) {
    const feed = await (await getAccountClient()).getChannelsFeed()
    return feed.channels.map((channel) => ({ channelId: channel.id, channelName: channel.author.name,
      thumbnailUrl: channel.author.thumbnails[0]?.url ?? null, subscribedAt: 0 }))
  }
  return listActiveSubscriptions()
}

export async function addSubscription(sub: Omit<Subscription, 'subscribedAt'>): Promise<void> {
  if (hasYoutubeAccount()) {
    await (await getAccountClient()).interact.subscribe(sub.channelId)
    return
  }
  return addActiveSubscription(sub)
}

export async function removeSubscription(channelId: string): Promise<void> {
  if (hasYoutubeAccount()) {
    await (await getAccountClient()).interact.unsubscribe(channelId)
    return
  }
  return removeActiveSubscription(channelId)
}
