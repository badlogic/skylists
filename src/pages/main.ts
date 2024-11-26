import { html, nothing, TemplateResult } from "lit";
import { map } from "lit-html/directives/map.js";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../app.js";
import { AppBskyGraphSearchStarterPacks, AtpAgent } from "@atproto/api";
import { addProfileToList, aggregateData, AggregatedData, getFollows, getListsWithMembers, List, Profile, removeProfileFromList } from "./bsky.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { ref } from "lit/directives/ref.js";

type State =
    | {
          type: "login";
          error?: string;
          progress?: string;
      }
    | {
          type: "editing";
          filter: {
              tokens: ReturnType<typeof parseSearchTokens>;
              notInListOnly: boolean;
          };
      };

@customElement("main-page")
export class MainPage extends BaseElement {
    @state()
    state: State = { type: "login" };

    agent?: AtpAgent;
    data?: AggregatedData;

    applyState(state: State) {
        this.state = { ...state };
    }

    render() {
        return html`<div class="min-h-[100%] flex flex-col items-center p-4 gap-4 max-w-[600px]">
            <h1>Skylists</h1>
            ${this.renderLogin()} ${this.renderEditing()}
            <div class="flex-grow"></div>
            <div class="text-center text-xs italic">
                <a href="https://skylists.mariozechner.at" target="_blank">Skylists</a>
                is lovingly made by
                <a href="https://bsky.app/profile/badlogic.bsky.social" target="_blank">Mario Zechner</a><br />
                <a href="https://github.com/badlogic/skylists" target="_blank">Source code</a>
            </div>
        </div>`;
    }

    renderLogin() {
        if (this.state.type != "login") return html``;
        const state = this.state;

        /*if (localStorage.getItem("data")) {
            this.data = JSON.parse(localStorage.getItem("data")!);
            this.state = {
                type: "editing",
                filter: {
                    tokens: {
                        excluded: [],
                        optional: [],
                        required: [],
                    },
                    notInListOnly: false,
                },
            };
            return html``;
        }*/

        const login = async () => {
            state.error = undefined;
            this.applyState(state);

            const handleInput = document.querySelector<HTMLInputElement>("#handle")!;
            const passwordInput = document.querySelector<HTMLInputElement>("#password")!;
            const loginButton = document.querySelector<HTMLButtonElement>("button")!;
            handleInput.disabled = passwordInput.disabled = loginButton.disabled = true;

            const handle = handleInput.value.trim().replace("@", "").toLowerCase();
            const password = passwordInput.value.trim();
            if (handle.length == 0 || password.length == 0) {
                handleInput.disabled = passwordInput.disabled = loginButton.disabled = false;
                state.error = "Please provide a handle and password.";
                this.applyState(state);
                return;
            }

            state.progress = "Logging in...";
            this.applyState(state);

            this.agent = new AtpAgent({ service: "https://bsky.social" });
            try {
                await this.agent.login({ identifier: handle, password });
            } catch (e) {
                handleInput.disabled = passwordInput.disabled = loginButton.disabled = false;
                state.progress = undefined;
                state.error = "Could not log in. Check your handle and password.";
                this.applyState(state);
                return;
            }

            state.progress = "Fetching your lists & follows";
            this.applyState(state);

            try {
                this.data = await aggregateData(await getFollows(this.agent), await getListsWithMembers(this.agent));
                // localStorage.setItem("data", JSON.stringify(this.data));
                console.log("Done");
            } catch (e) {
                handleInput.disabled = passwordInput.disabled = loginButton.disabled = false;
                state.progress = undefined;
                state.error = "Could not fetch your follows.";
                this.applyState(state);
                return;
            }

            this.applyState({
                type: "editing",
                filter: {
                    tokens: { excluded: [], optional: [], required: [] },
                    notInListOnly: false,
                },
            });
        };

        return html`<span class="text-center max-w-[300px]">Sort your follows into lists, quickly.</span>
            <div class="flex flex-col gap-2 max-w-[300px] w-[300px] gap-2">
                <input class="border border-border rounded-lg px-2 py-1 w-full" id="handle" placeholder="Handle, e.g. badlogic.bsky.social" />
                <input class="border border-border rounded-lg px-2 py-1 w-full" id="password" type="password" placeholder="App password" />
                <button @click=${login}>Log in</button>
                <span class="text-muted text-xs text-center"
                    >Skylists only uses your credentials to communicate with Bluesky. Your credentials are only stored in your computer's RAM for the
                    duration of your site visit. Use an <a href="https://bsky.app/settings/app-passwords" target="_blank">app password</a>.</span
                >
                ${state.progress ? html`<div class="text-center">${state.progress}</div>` : ""}
                ${state.error ? html`<div class="text-error text-center">${state.error}</div>` : ""}
            </div>`;
    }

    renderEditing() {
        if (this.state.type != "editing") return html``;
        if (!this.data) return html`<div class="text-error text-center">No data to display</div>`;
        // if (!this.agent) return html`<div class="text-error text-center">Not logged in</div>`;

        const state = this.state;
        const data = this.data;
        const agent = this.agent;

        const filteredProfiles = this.data.profiles.filter((account) => {
            const searchInput = this.querySelector<HTMLInputElement>("#search");
            if (searchInput && searchInput.value.trim().length > 0) {
                const searchTokens = state.filter.tokens;
                const searchableText = `${account.handle} ${account.displayName ?? ""} ${account.description || ""}`.toLowerCase();

                if (searchTokens.excluded.some((term) => searchableText.includes(term))) return false;
                if (!searchTokens.required.every((term) => searchableText.includes(term))) return false;
                if (searchTokens.optional.length > 0 && !searchTokens.optional.some((term) => searchableText.includes(term))) return false;
            }

            if (state.filter.notInListOnly && account.lists.length > 0) return false;

            return true;
        });

        const search = (e: InputEvent) => {
            const input = e.target as HTMLInputElement;
            state.filter.tokens = parseSearchTokens(input.value);
            this.applyState(state);
        };

        const notInListOnlyChanged = (e: Event) => {
            const checkbox = e.target as HTMLInputElement;
            state.filter.notInListOnly = checkbox.checked;
            this.applyState(state);
        };

        return html`
            <div class="w-full p-4 flex flex-col border border-border rounded-lg">
                <h1>Filters</h1>
                <div class="flex flex-col gap-2">
                    <span class="text-bold">Search handles & bios</span>
                    <input
                        id="search"
                        class="rounded-lg border border-border px-2 py-1"
                        @input=${search}
                        type="text"
                        placeholder="e.g. developer +engineer -recruiter"
                    />
                    <div class="text-sm text-gray-600">+word: must contain word, -word: must not contain word</div>
                </div>

                <div class="flex gap-4 items-center">
                    <label class="flex gap-2 items-center">
                        <input type="checkbox" id="with-following" .checked=${state.filter.notInListOnly} @change=${notInListOnlyChanged} />
                        <span>Only profiles not in a list</span>
                    </label>
                </div>
            </div>
            <infinite-scroller
                .items=${filteredProfiles}
                .renderItem=${(profile: Profile) =>
                    renderProfile(agent!, profile, data.lists, state.filter.tokens.required, state.filter.tokens.optional)}
            ></infinite-scroller>
        `;
    }
}

function parseSearchTokens(searchText: string) {
    const tokens = searchText
        .trim()
        .split(/\s+/)
        .filter((t) => t);
    const required = tokens.filter((t) => t.startsWith("+")).map((t) => t.slice(1).toLowerCase());
    const excluded = tokens.filter((t) => t.startsWith("-")).map((t) => t.slice(1).toLowerCase());
    const optional = tokens.filter((t) => !t.startsWith("+") && !t.startsWith("-")).map((t) => t.toLowerCase());
    return { required, excluded, optional };
}

function highlightTokens(text: string, required: string[], optional: string[]) {
    if (!text || !required || !optional) return text;

    const createPattern = (tokens: string[]) => {
        if (tokens.length === 0) return null;
        const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        return new RegExp(`(${escaped.join("|")})`, "gi");
    };

    const requiredPattern = createPattern(required);
    const optionalPattern = createPattern(optional);

    let result = text;

    if (requiredPattern) {
        result = result.replace(requiredPattern, '<span style="background-color: #90EE90; padding: 0 2px; border-radius: 2px;">$1</span>');
    }

    if (optionalPattern) {
        result = result.replace(optionalPattern, '<span style="background-color: #FFE4B5; padding: 0 2px; border-radius: 2px;">$1</span>');
    }

    return unsafeHTML(result);
}

function renderProfile(agent: AtpAgent, account: Profile, allLists: List[], required: string[], optional: string[]) {
    const listToggled = async (e: CustomEvent<{ text: string; data?: string; selected: boolean }>) => {
        const listUri = e.detail.data ?? "";
        const isSelected = e.detail.selected;
        const list = allLists.find((list) => list.uri == listUri);

        if (!list) {
            alert("Could not find list " + listUri);
            return;
        }

        try {
            if (isSelected) {
                await addProfileToList(agent, account, list);
            } else {
                await removeProfileFromList(agent, account, listUri);
            }
        } catch (err) {
            console.error("Failed to update list membership:", err);
            // You might want to revert the toggle state or show an error message
        }
    };

    return html`
        <div class="flex flex-col gap-2 mb-2" style="border: 1px solid #ccc; border-radius: 0.5em; padding: 1em;">
            <div class="flex gap-2 items-center">
                ${account.avatar
                    ? html`<img loading="lazy" style="width: 64px; height: 64px; border-radius: 100%;" src="${account.avatar}" />`
                    : html`<span class="sus">No Pic</span>`}
                <div class="flex flex-col">
                    <a href="https://bsky.app/profile/${account.handle}" target="_blank">${account.displayName || account.handle}</a>
                    ${account.displayName
                        ? html`<a href="https://bsky.app/profile/${account.handle}" target="_blank" class="text-sm" style="color: #777"
                              >${account.handle}</a
                          >`
                        : ""}
                </div>
            </div>
            <div class="flex gap-2">
                ${!account.following ? html`<span class="green-pill">Not followed by you</span>` : ""}
                ${account.followedBy ? html`<span class="green-pill">Follows you</span>` : ""}
            </div>
            ${account.description
                ? html`<div style="word-break: break-word; overflow-wrap: break-word;">
                      ${highlightTokens(account.description, required, optional)}
                  </div>`
                : html`<div style="color: red;">No bio</div>`}
            <div class="flex flex-col gap-1">
                ${allLists.map(
                    (list) =>
                        html`<toggle-button
                            .text=${list.name}
                            .data=${list.uri}
                            .selected=${account.lists.some((other) => other.uri == list.uri)}
                            @toggle-change=${listToggled}
                        ></toggle-button>`
                )}
            </div>
        </div>
    `;
}

@customElement("toggle-button")
export class ToggleButton extends BaseElement {
    @property()
    text: string = "";

    @property()
    data?: string;

    @property()
    selected: boolean = false;

    @property()
    disabled: boolean = false;

    private handleClick(): void {
        if (!this.disabled) {
            this.selected = !this.selected;
            this.dispatchEvent(
                new CustomEvent<{ text: string; data?: string; selected: boolean }>("toggle-change", {
                    detail: { text: this.text, data: this.data, selected: this.selected },
                    bubbles: true,
                    composed: true,
                })
            );
        }
    }

    render(): TemplateResult {
        const baseClasses: string = `
    `;

        const stateClasses: string = this.selected ? "border bg-link text-white" : "border border-gray-300 text-gray-700";

        return html`
            <div class="px-2 py-1 rounded-lg ${stateClasses}" @click=${this.handleClick} ?disabled=${this.disabled} type="button">${this.text}</div>
        `;
    }
}

type RenderItemFn<T> = (item: T) => TemplateResult;

@customElement("infinite-scroller")
export class InfiniteScroller<T> extends BaseElement {
    @property({ attribute: false })
    items: T[] = [];

    @property({ attribute: false })
    renderItem!: RenderItemFn<T>;

    @state()
    private visibleCount: number = 25;

    private observer: IntersectionObserver | null = null;
    private lastItemRef: HTMLElement | null = null;

    connectedCallback() {
        super.connectedCallback();
        this.setupIntersectionObserver();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.lastItemRef = null;
    }

    private setupIntersectionObserver() {
        if (this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver(
            (entries) => {
                const lastEntry = entries[0];
                if (lastEntry.isIntersecting) {
                    // Use requestAnimationFrame to avoid potential race conditions
                    requestAnimationFrame(() => {
                        this.loadMore();
                    });
                }
            },
            {
                threshold: 0.1,
                rootMargin: "100px",
            }
        );
        if (this.lastItemRef) {
            this.observer.observe(this.lastItemRef);
        }
    }

    private loadMore() {
        if (this.visibleCount < this.items.length) {
            const nextCount = Math.min(this.visibleCount + 25, this.items.length);
            if (nextCount !== this.visibleCount) {
                this.visibleCount = nextCount;
                this.requestUpdate();
            }
        }
    }

    private updateLastItemRef(element: HTMLElement | null) {
        if (this.lastItemRef && this.observer) {
            this.observer.unobserve(this.lastItemRef);
        }

        this.lastItemRef = element;
        if (element && this.observer) {
            this.observer.observe(element);
        }
    }

    protected render(): TemplateResult {
        const visibleItems = this.items.slice(0, this.visibleCount);
        const hasMore = this.visibleCount < this.items.length;

        return html`
            <div class="flex flex-col gap-2">
                ${visibleItems.map(
                    (item, index) => html`
                        <div ${index === visibleItems.length - 1 ? ref((el) => this.updateLastItemRef(el as HTMLElement)) : nothing}>
                            ${this.renderItem(item)}
                        </div>
                    `
                )}
                ${hasMore ? html`<div class="text-sm text-gray-600 text-center py-2">Loading more...</div>` : nothing}
            </div>
        `;
    }
}
