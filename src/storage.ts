import { Follower, Host, ODPClient } from "./model/ODPClient.js"

const storage = browser.storage.local

const serverKey = "server"

export async function getServer(): Promise<string | undefined> {
    return (await storage.get(serverKey))[serverKey]
}

export async function setServer(server: string): Promise<void> {
    return await storage.set({ [serverKey]: server })
}

export async function removeServer(): Promise<void> {
    return await storage.remove(serverKey)
}

const typeKey = "type"
const idKey = "id"
const hostIdKey = "hostId"
const followerIdKey = "followerId"

export async function getODPClient(): Promise<ODPClient | null> {
    const type = (await storage.get(typeKey))[typeKey]
    if (type == null) {
        return null
    }
    const id = (await storage.get(idKey))[idKey]
    if (type === ODPClient.HostTag) {
        return new ODPClient(new Host(id))
    } else if (type == ODPClient.FollowerTag) {
        return new ODPClient(new Follower(id))
    } else {
        return null
    }
}

export async function setODPClient(odpClient: ODPClient): Promise<void> {
    let id
    if (odpClient.contents instanceof Host) {
        id = odpClient.contents.id
        await storage.set({ [hostIdKey]: id })
    } else {
        id = odpClient.contents.hostToFollow
        await storage.set({ [followerIdKey]: id })
    }
    await storage.set({ [typeKey]: odpClient.tag, [idKey]: id })
}

export async function removeODPClient(): Promise<void> {
    await storage.remove([typeKey, idKey])
}

export async function getSavedHostId(): Promise<string | undefined> {
    return (await storage.get(hostIdKey))[hostIdKey]
}

export async function getSavedFollowerId(): Promise<string | undefined> {
    return (await storage.get(followerIdKey))[followerIdKey]
}
