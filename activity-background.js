/* Records are accepted only from the two trusted background follow managers. */
(() => {
  'use strict';
  const R = globalThis.MagpieActivity, C = globalThis.MagpieReply, KEY = 'followActivityState';
  function create({ getSettings, now = () => Date.now() }) {
    let saved = { accounts: [] }, queue = Promise.resolve();
    const ready = (async () => {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      if (stored) { saved = R.state(stored, now()); return; }
      // v0.7 recorded successful automatic actions, but not their animation IDs.
      // Recover today's known successes once; uncertain actions are excluded.
      const previous = (await chrome.storage.local.get('autoFollowState')).autoFollowState;
      saved = R.state({ accounts: (previous?.accounts || []).map(row => ({ account: row.account, events: (row.history || []).map(item => ({
        id: `legacy:${row.account}:${item.account}:${item.at}`, account: row.account, target: item.account, source: 'auto', status: item.status, at: item.at
      })) })) }, now());
      await chrome.storage.local.set({ [KEY]: saved });
    })();
    ready.catch(() => {});
    async function snapshot(owner) {
      await ready; const options = await getSettings();
      return R.snapshot(saved, R.account(owner || options.xAccount), options.autoFollowDaily, now());
    }
    function record(input) {
      const action = queue.catch(() => {}).then(async () => {
        await ready;
        const event = R.event(input, now()); if (!event) return { added: false };
        saved = R.state(saved, now());
        let row = saved.accounts.find(row => row.account === event.account);
        if (!row) { row = { account: event.account, events: [] }; saved.accounts.push(row); saved.accounts = saved.accounts.slice(-50); }
        if (row.events.some(row => row.id === event.id)) return { added: false };
        row.events.push(event); row.events = row.events.slice(-R.MAX_EVENTS);
        await chrome.storage.local.set({ [KEY]: saved });
        const data = await snapshot(event.account), tabs = await chrome.tabs.query({});
        await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id) && C.xURL(tab.url)).map(tab => chrome.tabs.sendMessage(tab.id, { type: 'FOLLOW_ACTIVITY_UPDATED', data, event })));
        return { added: true, data };
      });
      queue = action; return action;
    }
    return { ready, snapshot, record };
  }
  globalThis.MagpieActivityBackground = Object.freeze({ create });
})();
