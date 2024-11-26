import { AtpAgent } from "@atproto/api";

export type ProfileList = {
    name: string;
    uri: string;
    itemUri: string;
    itemRkey: string;
};

export type Profile = {
    did: string;
    displayName?: string;
    handle: string;
    avatar?: string;
    description?: string;
    following: boolean;
    followedBy: boolean;
    lists: ProfileList[];
};

export type List = {
    name: string;
    purpose?: string;
    uri: string;
};

export type AggregatedData = {
    profiles: Profile[];
    lists: List[];
};

export async function getFollows(agent: AtpAgent) {
    let cursor: string | undefined = undefined;
    const allFollows = [];

    while (true) {
        try {
            const response = await agent.getFollows({
                actor: agent.did!,
                cursor: cursor,
                limit: 100,
            });

            if (!response.success) {
                throw new Error("Failed to fetch follows");
            }

            allFollows.push(...response.data.follows);

            if (!response.data.cursor) {
                break;
            }

            cursor = response.data.cursor;
        } catch (error) {
            console.error("Error fetching follows:", error);
            throw error;
        }
    }

    return allFollows;
}

export async function getListsWithMembers(agent: AtpAgent) {
    const allLists = [];
    let listsCursor: string | undefined = undefined;

    while (true) {
        const listsResponse = await agent.app.bsky.graph.getLists({
            actor: agent.did!,
            cursor: listsCursor,
            limit: 100,
        });

        if (!listsResponse.success) {
            throw new Error("Failed to fetch lists");
        }

        for (const list of listsResponse.data.lists) {
            const members = [];
            let membersCursor: string | undefined = undefined;

            while (true) {
                const membersResponse = await agent.app.bsky.graph.getList({
                    list: list.uri,
                    cursor: membersCursor,
                    limit: 100,
                });

                if (!membersResponse.success) {
                    throw new Error(`Failed to fetch members for list: ${list.name}`);
                }
                members.push(...membersResponse.data.items);

                if (!membersResponse.data.cursor) {
                    break;
                }
                membersCursor = membersResponse.data.cursor;
            }

            allLists.push({
                name: list.name,
                uri: list.uri,
                purpose: list.purpose,
                members,
            });
        }

        if (!listsResponse.data.cursor) {
            break;
        }
        listsCursor = listsResponse.data.cursor;
    }

    return allLists;
}

// Update the aggregation function to include the list item data
export async function aggregateData(
    follows: Awaited<ReturnType<typeof getFollows>>,
    lists: Awaited<ReturnType<typeof getListsWithMembers>>
): Promise<AggregatedData> {
    const profilesMap = new Map<string, Profile>();
    const orderedProfiles: Profile[] = [];

    for (const follow of follows) {
        const profile: Profile = {
            did: follow.did,
            displayName: follow.displayName,
            handle: follow.handle,
            avatar: follow.avatar,
            description: follow.description,
            following: true,
            followedBy: Boolean(follow.viewer?.followedBy),
            lists: [],
        };
        profilesMap.set(follow.did, profile);
        orderedProfiles.push(profile);
    }

    const myLists: List[] = lists.map((list) => ({
        name: list.name,
        purpose: list.purpose,
        uri: list.uri,
    }));

    for (const list of lists) {
        for (const member of list.members) {
            const profile = member.subject;
            const existingProfile = profilesMap.get(profile.did);

            // Now include the list item data needed for removal
            const listInfo: ProfileList = {
                name: list.name,
                uri: list.uri,
                itemUri: member.uri,
                itemRkey: member.uri.split("/").pop()!,
            };

            if (existingProfile) {
                existingProfile.lists.push(listInfo);
            } else {
                const newProfile: Profile = {
                    did: profile.did,
                    displayName: profile.displayName,
                    handle: profile.handle,
                    avatar: profile.avatar,
                    description: profile.description,
                    following: false,
                    followedBy: Boolean(profile.viewer?.followedBy),
                    lists: [listInfo],
                };
                profilesMap.set(profile.did, newProfile);
                orderedProfiles.push(newProfile);
            }
        }
    }

    return {
        profiles: orderedProfiles,
        lists: myLists,
    };
}

export async function addProfileToList(agent: AtpAgent, profile: Profile, list: List) {
    // Create the list item using com.atproto.repo.createRecord
    const createResponse = await agent.com.atproto.repo.createRecord({
        repo: agent.session?.did!, // the authenticated user's DID
        collection: "app.bsky.graph.listitem",
        record: {
            list: list.uri,
            subject: profile.did,
            createdAt: new Date().toISOString(),
        },
    });

    // Extract the URI and rkey from the response
    const itemRkey = createResponse.data.uri.split("/").pop()!;
    const listInfo: ProfileList = {
        name: list.name,
        uri: list.uri,
        itemUri: createResponse.data.uri,
        itemRkey: itemRkey,
    };
    profile.lists.push(listInfo);
}

export async function removeProfileFromList(agent: AtpAgent, profile: Profile, listUri: string) {
    const listItem = profile.lists.find((list) => list.uri === listUri);
    if (!listItem) {
        throw new Error(`Profile ${profile.handle} is not in list ${listUri}`);
    }

    // Extract the repo (DID) from the itemUri
    const repo = listItem.itemUri.split("/")[2];

    await agent.com.atproto.repo.deleteRecord({
        repo: repo,
        collection: "app.bsky.graph.listitem",
        rkey: listItem.itemRkey,
    });

    // Update the profile's lists array
    profile.lists = profile.lists.filter((list) => list.uri !== listUri);
}
