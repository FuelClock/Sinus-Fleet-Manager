registerPlugin({
    name: 'Fleet Manager',
    version: '1.0.0',
    engine: '>= 0.13.37',
    backends: ['ts3'],
    autorun: false,
    description: 'Race-safe Fleet System channel hierarchy manager for TeamSpeak 3.',
    author: 'FuelClock',
    // Grouped configuration (layout B): type-less vars render as section
    // headers, `indent` nests, and `conditions` hide dependent fields. Each
    // spacer has its own checkbox that removes it from the channel layout
    // entirely; the matching name field is only shown while it is enabled.
    vars: [
        { name: 'header_commands', title: '── Commands ──' },
        { name: 'BOT_NAME', title: 'Command prefix — commands are typed as !<prefix>', type: 'string', placeholder: 'Default: fs' },
        { name: 'header_placement', title: '── Where the fleet lives ──' },
        { name: 'PARENT_CHANNEL_ID', title: 'Anchor channel', type: 'channel' },
        {
            name: 'FLEET_PLACEMENT',
            title: 'Placement',
            type: 'select',
            options: ['Below the anchor (as siblings)', 'Inside the anchor (as subchannels)'],
            placeholder: 'Default: Below the anchor'
        },
        { name: 'header_layout', title: '── Division & squad layout ──' },
        { name: 'MAX_SQUADS', title: 'Max squads per division', type: 'number', placeholder: 'Default: 4' },
        {
            name: 'DIVISION_NAMING_MODE',
            title: 'Division naming',
            type: 'select',
            options: ['Numbered (Division 1, Division 2, ...)', 'Name pool (Division Alpha, Division Bravo, ...)'],
            placeholder: 'Default: Numbered'
        },
        {
            name: 'DIVISION_NAME_POOL', indent: 2,
            title: 'Name pool (comma separated, one per division)',
            type: 'string', placeholder: 'Default: Alpha,Bravo,Charlie,Delta',
            conditions: [{ field: 'DIVISION_NAMING_MODE', value: 1 }]
        },
        { name: 'header_appearance', title: '── Channel appearance ──' },
        { name: 'COMMAND_ROOM_NAME', title: 'Command Room name', type: 'string', placeholder: 'Default: Command Room' },
        {
            name: 'SPACER_ENABLED', indent: 0,
            title: 'Spacer above the Command Room', type: 'checkbox'
        },
        {
            name: 'SPACER_NAME', indent: 2,
            title: 'Spacer text',
            type: 'string', placeholder: 'Default: [spacerfleet0]',
            conditions: [{ field: 'SPACER_ENABLED', value: true }]
        },
        {
            name: 'TITLE_SPACER_ENABLED',
            title: 'Title spacer between the spacer above and the Command Room', type: 'checkbox'
        },
        {
            name: 'TITLE_SPACER_NAME', indent: 2,
            title: 'Title spacer text',
            type: 'string', placeholder: 'Default: [cspacerSquad1]-=-=  Group System  =-=-',
            conditions: [{ field: 'TITLE_SPACER_ENABLED', value: true }]
        },
        {
            name: 'SPACER_BELOW_ENABLED',
            title: 'Spacer below the Command Room', type: 'checkbox'
        },
        {
            name: 'SPACER_BELOW_NAME', indent: 2,
            title: 'Spacer text',
            type: 'string', placeholder: 'Default: [spacerfleet1]',
            conditions: [{ field: 'SPACER_BELOW_ENABLED', value: true }]
        },
        { name: 'header_cleanup', title: '── Automatic cleanup ──' },
        {
            name: 'DIVISION_CLEANUP_MODE',
            title: 'When a division is switched off and left empty',
            type: 'select',
            options: ['Delete it', 'Keep it until it is used again'],
            placeholder: 'Default: Delete it'
        },
        { name: 'SQUAD_DELETE_DELAY', title: 'Empty squad removal delay (seconds)', type: 'number', placeholder: 'Default: 1' },
        { name: 'DIVISION_DELETE_DELAY', title: 'Empty division removal delay (seconds)', type: 'number', placeholder: 'Default: 1' },
        { name: 'WATCHDOG_ENABLED', title: 'Watchdog — re-check the fleet layout automatically', type: 'checkbox' },
        {
            name: 'RECONCILIATION_INTERVAL', indent: 2,
            title: 'Check interval (seconds)',
            type: 'number', placeholder: 'Default: 2',
            conditions: [{ field: 'WATCHDOG_ENABLED', value: true }]
        },
        { name: 'header_access', title: '── Access ──' },
        { name: 'ADMIN_GROUP', title: 'Administrator server group ID', type: 'number', placeholder: 'Default: 17' },
        { name: 'header_squad_admin', title: '── Squad channel admin ──' },
        {
            name: 'SQUAD_ADMIN_ENABLED',
            title: 'Give the first person in a squad the channel admin group', type: 'checkbox'
        },
        {
            name: 'SQUAD_ADMIN_GROUP', indent: 2,
            title: 'Channel group ID to hand out',
            type: 'number', placeholder: 'Default: 6 (the stock "Channel Admin" group)',
            conditions: [{ field: 'SQUAD_ADMIN_ENABLED', value: true }]
        },
        {
            name: 'SQUAD_ADMIN_APPLY_TO', indent: 2,
            title: 'Apply to',
            type: 'select',
            options: ['Squads only', 'Squads and divisions'],
            placeholder: 'Default: Squads only',
            conditions: [{ field: 'SQUAD_ADMIN_ENABLED', value: true }]
        }
    ]
}, function (sinusbot, config) {
    var engine = require('engine');
    var event = require('event');
    var backend = require('backend');
    var store = require('store');
    var lib;

    try {
        lib = require('OKlib.js');
    } catch (e) {
        engine.log('Fleet Manager: OKlib.js is required. Install OKlib before enabling this script.');
        return;
    }
    if (!lib || !lib.general || !lib.channel || !lib.client || !lib.general.checkVersion('1.0.6')) {
        engine.log('Fleet Manager: OKlib 1.0.6 or newer is required.');
        return;
    }

    var prefix = '!' + (config.BOT_NAME || 'fs');
    function configuredId(value) {
        if (!value) return '';
        if (typeof value === 'object' && typeof value.id === 'function') return String(value.id());
        if (typeof value === 'object' && value.id !== undefined) return String(value.id);
        return String(value);
    }
    var parentId = configuredId(config.PARENT_CHANNEL_ID);
    var commandRoomName = config.COMMAND_ROOM_NAME || 'Command Room';
    // Checkbox vars are absent from configs saved before the setting existed.
    // `undefined` must therefore mean ENABLED for the pre-existing spacers,
    // and only an explicit `false` turns one off. Accepts booleans as well as
    // the old select values (0/'0'/'disabled', 1/'1'/'enabled') so a config
    // saved against the previous version keeps working untouched.
    function toggle(name, defaultOn) {
        var value = config[name];
        if (value === undefined || value === null || value === '') return defaultOn;
        if (value === true || value === 'true' || value === 1 || value === '1' || value === 'enabled') return true;
        if (value === false || value === 'false' || value === 0 || value === '0' || value === 'disabled') return false;
        return defaultOn;
    }
    var spacerEnabled = toggle('SPACER_ENABLED', true);
    var spacerBelowEnabled = toggle('SPACER_BELOW_ENABLED', true);
    var watchdogEnabled = toggle('WATCHDOG_ENABLED', true);
    var spacerName = config.SPACER_NAME || '[spacerfleet0]';
    var spacerBelowName = config.SPACER_BELOW_NAME || '[spacerfleet1]';
    var maxSquads = Math.max(1, parseInt(config.MAX_SQUADS, 10) || 4);
    var MAX_DIVISIONS = 10;
    var squadDeleteDelay = Math.max(1, parseInt(config.SQUAD_DELETE_DELAY, 10) || 1);
    var divisionDeleteDelay = Math.max(1, parseInt(config.DIVISION_DELETE_DELAY, 10) || 1);
    var reconciliationInterval = Math.max(1, parseInt(config.RECONCILIATION_INTERVAL, 10) || 2);
    var deleteDivisionsOnOff = !(config.DIVISION_CLEANUP_MODE === 1 || config.DIVISION_CLEANUP_MODE === '1' || config.DIVISION_CLEANUP_MODE === 'keep');
    var standardNames = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    var titleSpacerEnabled = toggle('TITLE_SPACER_ENABLED', true);
    // Absent from configs saved before this feature existed -> OFF, so an
    // upgrade never starts handing out channel admin rights uninvited.
    var squadAdminEnabled = toggle('SQUAD_ADMIN_ENABLED', false);
    var squadAdminGroupId = parseInt(config.SQUAD_ADMIN_GROUP, 10);
    if (isNaN(squadAdminGroupId)) squadAdminGroupId = 6;   // stock "Channel Admin"
    var squadAdminAlsoDivisions = config.SQUAD_ADMIN_APPLY_TO === 1 || config.SQUAD_ADMIN_APPLY_TO === '1';
    // Fallback to the default name so the disabled path can still find and
    // remove a leftover title spacer even if defaults are not injected.
    var titleSpacerName = String(config.TITLE_SPACER_NAME || '').trim() || '[cspacerSquad1]-=-=  Group System  =-=-';
    var fallbackNames = ['Echo', 'Foxtrot', 'Guido', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu'];
    var stateKey = 'fleetManagerState_' + (engine.getInstanceID ? engine.getInstanceID() : 'default');
    var state = loadState();
    var operationRunning = false;
    var sortingSuspended = false;
    var pendingAction = null;
    var pendingResolve = null;
    var pendingReject = null;
    var cleanupTimer;

    function log(message, level) {
        lib.general.log('Fleet Manager: ' + message, level || 4);
    }

    function loadState() {
        var value = store.get(stateKey);
        value = value || {
            active: false,
            divisionModeActive: false,
            commandRoomId: '',
            spacerId: '',
            spacerBelowId: '',
            titleSpacerId: '',
            parentId: '',
            divisionIds: [],
            squadIds: [],
            emptySince: {},
            divisionEmptySince: {},
            // channelId -> clientId of the client currently holding channel
            // admin in that channel. Persisted so a bot reload does not
            // re-award the group to whoever happens to be sitting there.
            squadAdmins: {}
        };
        value.divisionIds = Array.isArray(value.divisionIds) ? value.divisionIds : [];
        value.squadIds = Array.isArray(value.squadIds) ? value.squadIds : [];
        value.emptySince = value.emptySince || {};
        value.divisionEmptySince = value.divisionEmptySince || {};
        value.squadAdmins = value.squadAdmins || {};
        return value;
    }

    function saveState() {
        store.set(stateKey, state);
    }

    function idOf(channel) {
        return channel && String(channel.id());
    }

    function sameId(channel, id) {
        return channel && idOf(channel) === String(id);
    }

    function channelsUnder(parent) {
        // OKlib expects a valid Channel object and throws when reconnects leave
        // a persisted/configured channel temporarily unresolved.
        if (!parent || typeof parent.id !== 'function') return [];
        return lib.channel.getSubchannels(parent, backend.getChannels()) || [];
    }

    function findExactChild(parent, name) {
        var children = channelsUnder(parent);
        for (var i = 0; i < children.length; i++) {
            if (children[i].name() === name) return children[i];
        }
        return null;
    }

    function anchorParent(anchor) {
        return anchor && anchor.parent ? anchor.parent() : null;
    }

    function sameParent(a, b) {
        var ap = anchorParent(a);
        var bp = anchorParent(b);
        if (!ap && !bp) return true;
        return ap && bp && sameId(ap, idOf(bp));
    }

    // Anchor relationship (Private Channel Manager parity, channelOrder):
    // 'Below the anchor'  -> the fleet base channels are siblings of the
    //                        anchor, i.e. parent = anchor.parent()
    // 'Inside the anchor' -> they are subchannels of the anchor itself
    var placeInsideAnchor = config.FLEET_PLACEMENT === 1 || config.FLEET_PLACEMENT === '1' || config.FLEET_PLACEMENT === 'subchannels' || config.FLEET_PLACEMENT === 'inside';
    var placementKey = placeInsideAnchor ? 'sub' : 'sib';

    function placementParent(anchor) {
        if (!anchor) return null;
        return placeInsideAnchor ? anchor : anchorParent(anchor);
    }

    function samePlacementParent(channel, anchor) {
        var cp = channel && channel.parent ? channel.parent() : null;
        var pp = placementParent(anchor);
        if (!cp && !pp) return true;
        return cp && pp && sameId(cp, idOf(pp));
    }

    // The channels the fleet considers its peers: children of the placement
    // parent. Covers both modes and the root-level case (parent = null).
    function placementSiblings(anchor) {
        var parent = placementParent(anchor);
        var all = backend.getChannels() || [];
        if (!parent) return all.filter(function (channel) { return !channel.parent(); });
        return channelsUnder(parent);
    }

    function findExactSibling(anchor, name) {
        var siblings = placementSiblings(anchor);
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].name() === name) return siblings[i];
        }
        return null;
    }

    function liveChannel(id) {
        return id ? backend.getChannelByID(String(id)) : null;
    }

    // Timing knobs: short poll intervals keep operations responsive (the
    // Private Channel Manager plugin uses the same fire-early pattern).
    var VERIFY_INTERVAL_MS = 100;
    var VERIFY_ATTEMPTS = 25;          // ~2.5s worst case per verification
    var DELETE_CONFIRM_DELAY_MS = 150;
    var JOIN_POWER_DELAY_MS = 250;
    var MOVE_RETRY_DELAY_MS = 300;

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function waitForChannel(id, predicate, attempts) {
        // `attempts || N` would reset the counter when it reaches 0 and loop
        // forever; only fall back for an omitted argument.
        attempts = (attempts === undefined) ? VERIFY_ATTEMPTS : attempts;
        var channel = liveChannel(id);
        if (channel && predicate(channel)) return Promise.resolve(channel);
        if (attempts <= 0) return Promise.reject(new Error('verification timeout for channel ' + id));
        return delay(VERIFY_INTERVAL_MS).then(function () { return waitForChannel(id, predicate, attempts - 1); });
    }

    function waitForChannelGone(id, attempts) {
        attempts = (attempts === undefined) ? VERIFY_ATTEMPTS : attempts;
        if (!liveChannel(id)) return Promise.resolve();
        if (attempts <= 0) return Promise.reject(new Error('channel ' + id + ' still exists after delete'));
        return delay(VERIFY_INTERVAL_MS).then(function () { return waitForChannelGone(id, attempts - 1); });
    }

    function channelParams(name, parent) {
        return { name: name, parent: idOf(parent), permanent: true, codec: 4, codecQuality: 6 };
    }

    function createOrFind(parent, name) {
        var existing = findExactChild(parent, name);
        if (existing) return sortManagedSiblings(parent).then(function () { return existing; });
        var created;
        try {
            created = backend.createChannel(channelParams(name, parent));
        } catch (e) {
            return Promise.reject(e);
        }
        if (created && idOf(created)) {
            return waitForChannel(idOf(created), function (channel) {
                return channel.name() === name && channel.parent() && sameId(channel.parent(), idOf(parent));
            }).then(function (channel) { return sortManagedSiblings(parent).then(function () { return channel; }); });
        }
        return delay(300).then(function () {
            var found = findExactChild(parent, name);
            if (!found) return Promise.reject(new Error('created channel was not returned by backend'));
            return sortManagedSiblings(parent).then(function () { return found; });
        });
    }

    // CHANNEL_ORDER is the ID of a channel to appear BELOW - and it must be a
    // SIBLING. A channel's own parent is not a valid order target: TS3 answers
    // "invalid channel order" and the move never lands. So "directly below the
    // placement parent" means the TOP of that parent's children (order 0).
    function orderBelow(anchor, belowChannel) {
        if (!belowChannel) return 0;
        var parent = placementParent(anchor);
        if (parent && sameId(parent, idOf(belowChannel))) return 0;
        return +idOf(belowChannel) || 0;
    }

    function moveSiblingVerified(channel, anchor, belowChannel) {
        var parent = placementParent(anchor);
        var target = parent ? idOf(parent) : 0;
        var order = orderBelow(anchor, belowChannel);
        var oldParent = channel.parent ? channel.parent() : null;
        function posOf(ch) { return ch && ch.position ? (+ch.position() || 0) : 0; }
        // Already exactly where it belongs: re-issuing the move every
        // reconcile would displace whatever currently sits below this channel.
        if (samePlacementParent(channel, anchor) && posOf(channel) === order) {
            return Promise.resolve(channel);
        }
        log('Moving channel "' + channel.name() + '" (id=' + idOf(channel) + ') below "' + (belowChannel ? belowChannel.name() : 'top') + '" (order=' + order + ').', 4);
        // SinusBot's moveTo may silently fail (no exception, no false), and
        // TS3 can reject an ordered move of root-level channels ("invalid
        // channel order"). Verify parent AND order after every attempt and
        // escalate: ordered moveTo -> setPosition -> unordered moveTo.
        // An unordered move lands the channel at the BOTTOM of the parent, so
        // it is a last resort and is reported loudly when it is the outcome.
        var modes = ['move', 'setpos', 'unordered'];
        var round = 0;
        var roundsLeft = 4;
        function tryMove(mode) {
            try {
                if (mode === 'move') return channel.moveTo(target, order) !== false;
                if (mode === 'setpos') {
                    if (typeof channel.setPosition === 'function') { channel.setPosition(order); return true; }
                    if (typeof channel.update === 'function') { channel.update({ position: order }); return true; }
                    return false;
                }
                return channel.moveTo(target) !== false;
            } catch (e) { return false; }
        }
        function parentOk() {
            return waitForChannel(idOf(channel), function (current) { return samePlacementParent(current, anchor); });
        }
        function attempt() {
            var mode = modes[round % modes.length];
            if (!tryMove(mode)) log('Move attempt "' + mode + '" for "' + channel.name() + '" was refused.', 3);
            return parentOk().then(function (current) {
                if (posOf(current) === order) {
                    return sortManagedSiblings(oldParent).then(function () {
                        return sortManagedSiblings(parent).then(function () { return current; });
                    });
                }
                return retry(current);
            }, function () {
                return retry(null);
            });
            function retry(current) {
                roundsLeft--;
                round++;
                if (roundsLeft <= 0) {
                    if (current) {
                        log('Order of "' + channel.name() + '" unconfirmed: position=' + posOf(current) + ' wanted=' + order + ' (target "' + channel.name() + '" may sit at the bottom of "' + (belowChannel ? belowChannel.name() : 'the top') + '").', 2);
                        return current;
                    }
                    return Promise.reject(new Error('could not move channel ' + idOf(channel) + ' below "' + (belowChannel ? belowChannel.name() : 'top') + '" after multiple attempts'));
                }
                log('Retrying move of "' + channel.name() + '" with "' + modes[round % modes.length] + '" (round ' + round + '/' + (roundsLeft + round) + ').', 3);
                return delay(MOVE_RETRY_DELAY_MS).then(attempt);
            }
        }
        return attempt();
    }

    function createOrFindBelow(anchor, name, belowChannel) {
        var below = belowChannel || anchor;
        var existing = findExactSibling(anchor, name);
        if (existing) return moveSiblingVerified(existing, anchor, below);
        var parent = placementParent(anchor);
        // TeamSpeak can reject a create-time position as "invalid channel
        // order", especially for root-level channels. Create at the default
        // position first, then place the channel with moveTo(parent, order).
        var params = { name: name, parent: parent ? idOf(parent) : 0, permanent: true, codec: 4, codecQuality: 6 };
        var created;
        try { created = backend.createChannel(params); } catch (e) { return Promise.reject(e); }
        if (created && idOf(created)) {
            return waitForChannel(idOf(created), function (channel) {
                return channel.name() === name && samePlacementParent(channel, anchor);
            }).then(function (channel) { return moveSiblingVerified(channel, anchor, below); });
        }
        return delay(300).then(function () {
            var found = findExactSibling(anchor, name);
            if (!found) return Promise.reject(new Error('created sibling channel was not returned by backend'));
            return moveSiblingVerified(found, anchor, below);
        });
    }

    function setNameVerified(channel, name) {
        if (channel.name() === name) return Promise.resolve(channel);
        var oldName = channel.name();
        log('Renaming "' + oldName + '" -> "' + name + '".', 4);
        try { channel.setName(name); } catch (e) { return Promise.reject(e); }
        var parent = channel.parent ? channel.parent() : null;
        return waitForChannel(idOf(channel), function (current) { return current.name() === name; }).then(function (current) {
            return sortManagedSiblings(parent).then(function () { return current; });
        });
    }

    // order defaults to 0 (top). Callers that move a SET of channels pass the
    // predecessor's id so the sequence lands in the intended order: moving
    // every channel with order 0 leaves them in reverse arrival order, which
    // is how an empty spare ended up above the occupied squad after a fold.
    function moveVerified(channel, parent, order) {
        var targetOrder = (order === undefined) ? 0 : order;
        log('Moving channel "' + channel.name() + '" (id=' + idOf(channel) + ') to parent ' + idOf(parent) + ' (order=' + targetOrder + ').', 4);
        // SinusBot's Channel.moveTo signature is moveTo(parent, order).
        // Omitting order produces "expected more parameters" and leaves the
        // squad in the Command Room even though the operation was logged.
        try { channel.moveTo(parent, targetOrder); } catch (e) { return Promise.reject(e); }
        var oldParent = channel.parent ? channel.parent() : null;
        return waitForChannel(idOf(channel), function (current) {
            return current.parent() && sameId(current.parent(), idOf(parent));
        }).then(function (current) {
            log('Verified channel ' + idOf(current) + ' is now under Command Room.', 5);
            return sortManagedSiblings(oldParent).then(function () {
                return sortManagedSiblings(parent).then(function () { return current; });
            });
        });
    }

    function deleteVerified(channel) {
        var id = idOf(channel);
        var name = channel.name();
        log('Deleting channel "' + name + '" (id=' + id + ').', 4);
        try { channel.delete(); } catch (e) { return Promise.reject(e); }
        var oldParent = channel.parent ? channel.parent() : null;
        return waitForChannelGone(id).then(function () {
            return sortManagedSiblings(oldParent).then(function () { return true; });
        });
    }

    function divisionName(number) {
        var pool = String(config.DIVISION_NAME_POOL || '').split(',').map(function (item) { return item.trim(); }).filter(Boolean);
        var poolMode = config.DIVISION_NAMING_MODE === 1 || config.DIVISION_NAMING_MODE === '1' || config.DIVISION_NAMING_MODE === 'pool';
        if (poolMode && pool[number - 1]) return 'Division ' + pool[number - 1];
        return 'Division ' + number;
    }

    function divisionNumber(channel) {
        var match = channel.name().match(/^Division\s+(\d+)$/i);
        return match ? parseInt(match[1], 10) : 0;
    }

    function isSquadName(name) {
        // Handles normal squad names: [D3] Squad Alpha (division mode)
        // Handles prefixless squad names: Squad Alpha (plain mode)
        // Handles stuck temporary names: [D3] Squad__FleetManagerRename_1088
        // Handles pure temporary names: __FleetManagerRename_1088
        return (/^\[D\d+\]\s*Squad(?:\s|_).+$/i.test(name) || /^Squad(?:\s|_).+$/i.test(name) || /^__FleetManagerRename_\d+$/i.test(name));
    }

    function isDivisionChannel(channel) {
        return channel && /^Division\s+/i.test(channel.name());
    }

    function managedSortKey(channel) {
        return String(channel.name()).toLowerCase();
    }

    function sortManagedSiblings(parent) {
        if (sortingSuspended) return Promise.resolve();
        if (!parent || typeof parent.id !== 'function') return Promise.resolve();
        var all = channelsUnder(parent).slice();
        var managed = all.filter(function (channel) {
            return isSquadName(channel.name()) || isDivisionChannel(channel);
        });
        if (!managed.length) return Promise.resolve();
        managed.sort(function (a, b) {
            var aKey = isSquadName(a.name()) ? squadLabel(a.name()).toLowerCase() : managedSortKey(a);
            var bKey = isSquadName(b.name()) ? squadLabel(b.name()).toLowerCase() : managedSortKey(b);
            return aKey.localeCompare(bKey) || idOf(a).localeCompare(idOf(b));
        });
        // CHANNEL_ORDER is an ID (place-below), not a slot index: rebuild the
        // sibling chain. Keep non-managed channels in their current slots and
        // let the managed ones fill the remaining slots alphabetically; each
        // channel is then ordered below its predecessor by channel ID. The
        // head of the list keeps whatever it already sits below — forcing
        // order 0 would hoist managed channels above non-managed siblings.
        function posOf(channel) {
            return channel.position ? (+channel.position() || 0) : 0;
        }
        var slots = all.slice().sort(function (a, b) { return posOf(a) - posOf(b); });
        // The order value the block currently starts at. The new head inherits
        // the SLOT's order, not its own: after a fold permuted the block, the
        // alphabetically first channel was no longer the slot-0 channel, and
        // keeping its own (wrong) predecessor preserved the inversion - the
        // empty spare stayed above the occupied squad.
        var headOrder = posOf(slots[0]);
        var queue = managed.slice();
        slots = slots.map(function (channel) {
            if (queue.length && (isSquadName(channel.name()) || isDivisionChannel(channel))) return queue.shift();
            return channel;
        });
        return slots.reduce(function (promise, channel, index) {
            return promise.then(function () {
                var desired = index === 0 ? headOrder : orderBelow(parent, slots[index - 1]);
                if (posOf(channel) === desired) return channel;
                var movedSort = false;
                try { movedSort = channel.moveTo(parent, desired) !== false; } catch (eSort) { movedSort = false; }
                if (!movedSort) {
                    // Same "invalid channel order" restriction for root-level
                    // channels; move without order and let the next pass fix it.
                    try { channel.moveTo(parent); } catch (eSort2) { /* reported by verification */ }
                }
                return waitForChannel(idOf(channel), function (updated) {
                    return updated.parent() && sameId(updated.parent(), idOf(parent));
                });
            });
        }, Promise.resolve());
    }

    function squadLabel(name) {
        var match = name.match(/^\[D\d+\]\s*Squad\s+(.+)$/i) || name.match(/^Squad\s+(.+)$/i);
        return match ? match[1].trim() : name;
    }

    // divisionNumberValue 0 means plain mode: squads carry no division prefix.
    function squadName(divisionNumberValue, label) {
        return (divisionNumberValue ? '[D' + divisionNumberValue + '] ' : '') + 'Squad ' + label;
    }

    function targetSquadName(label, used, ordinal) {
        var candidates = standardNames.concat(fallbackNames);
        var desired = label;
        if (candidates.indexOf(desired) === -1 || used[desired]) {
            for (var i = 0; i < candidates.length; i++) {
                if (!used[candidates[i]]) { desired = candidates[i]; break; }
            }
            if (used[desired]) desired = 'Squad ' + (ordinal + 1);
        }
        used[desired] = true;
        return squadName(0, desired);
    }

    function discoverFleet(parent, commandRoom) {
        var divisions = [];
        var commandChildren = channelsUnder(commandRoom);
        for (var i = 0; i < commandChildren.length; i++) {
            if (divisionNumber(commandChildren[i]) || commandChildren[i].name().indexOf('Division ') === 0) divisions.push(commandChildren[i]);
        }
        divisions.sort(function (a, b) { return divisionNumber(a) - divisionNumber(b) || idOf(a).localeCompare(idOf(b)); });
        var squads = [];
        divisions.forEach(function (division) {
            channelsUnder(division).forEach(function (child) {
                if (isSquadName(child.name())) squads.push({ channel: child, division: division });
            });
        });
        return { divisions: divisions, squads: squads };
    }

    // Deletes all empty descendants of a channel (squads, divisions) so the
    // channel itself becomes deletable. Returns the names of occupied
    // descendants that blocked full clearance.
    function clearSubtree(ch) {
        var kids = channelsUnder(ch);
        var occupied = [];
        var chain = Promise.resolve();
        kids.forEach(function (kid) {
            chain = chain.then(function () {
                if (kid.getClientCount && kid.getClientCount() > 0) { occupied.push(kid.name()); return null; }
                return clearSubtree(kid).then(function (deeper) {
                    occupied = occupied.concat(deeper);
                    return deleteVerified(kid).then(function () { return null; }, function () { return null; });
                });
            });
        });
        return chain.then(function () { return occupied; });
    }

    // On an anchor change: delete the old base channels (they must be empty)
    // so ensureBase can create fresh ones below the new anchor. Moving
    // root-level channels between anchors is unreliable on TS3, so we never
    // attempt it.
    function deleteOldBaseChannels() {
        var targets = [];
        function addByRef(ch) {
            if (!ch) return;
            for (var i = 0; i < targets.length; i++) { if (sameId(targets[i], idOf(ch))) return; }
            targets.push(ch);
        }
        [state.spacerId, state.titleSpacerId, state.commandRoomId, state.spacerBelowId].forEach(function (id) { addByRef(liveChannel(id)); });
        var parent = liveChannel(parentId);
        if (parent) {
            [spacerName, titleSpacerName, commandRoomName, spacerBelowName].forEach(function (name) { addByRef(findExactSibling(parent, name)); });
            // A placement change (siblings <-> subchannels) leaves the base
            // channels in the other slot; catch them by name there too.
            var otherParent = placeInsideAnchor ? anchorParent(parent) : parent;
            var otherChannels = otherParent ? channelsUnder(otherParent) : (backend.getChannels() || []).filter(function (c) { return !c.parent(); });
            otherChannels.forEach(function (c) {
                if (c.name() === spacerName || c.name() === spacerBelowName || (titleSpacerName && c.name() === titleSpacerName) || c.name() === commandRoomName) addByRef(c);
            });
        }
        var keptCommandRoom = null;
        var chain = Promise.resolve();
        targets.forEach(function (ch) {
            chain = chain.then(function () {
                if (ch.name() === commandRoomName) {
                    // The Command Room regularly contains (empty) system squads
                    // and divisions; clear them first, then delete the room.
                    return clearSubtree(ch).then(function (occupied) {
                        if (occupied.length || (ch.getClientCount && ch.getClientCount() > 0)) {
                            log('Not deleting "Command Room" — occupied squads: ' + occupied.join(', '), 2);
                            keptCommandRoom = ch;
                            return null;
                        }
                        log('Deleting old fleet channel "Command Room" (anchor changed).', 4);
                        return deleteVerified(ch);
                    });
                }
                if (channelsUnder(ch).length || (ch.getClientCount && ch.getClientCount() > 0)) {
                    log('Not deleting "' + ch.name() + '" — it is not empty.', 2);
                    return null;
                }
                log('Deleting old fleet channel "' + ch.name() + '" (anchor changed).', 4);
                return deleteVerified(ch);
            });
        });
        return chain.then(function () {
            state.spacerId = ''; state.titleSpacerId = ''; state.commandRoomId = ''; state.spacerBelowId = '';
            if (keptCommandRoom) {
                throw new Error('the old Command Room still contains occupied squads; move the clients out before changing the anchor channel');
            }
        });
    }

    // The base layout is a chain of channels, each directly below its
    // predecessor. Which links exist depends on the three spacer checkboxes,
    // so the chain is built from a list instead of a hardcoded sequence.
    // The Command Room is always present and always last-but-one.
    function baseLayoutSteps() {
        var steps = [];
        if (spacerEnabled) steps.push({ key: 'spacerId', name: spacerName });
        if (titleSpacerEnabled) steps.push({ key: 'titleSpacerId', name: titleSpacerName, power: TITLE_SPACER_JOIN_POWER });
        steps.push({ key: 'commandRoomId', name: commandRoomName, power: COMMAND_ROOM_JOIN_POWER });
        if (spacerBelowEnabled) steps.push({ key: 'spacerBelowId', name: spacerBelowName });
        return steps;
    }

    // Spacer channels the user has switched off. Their names are still known
    // (the name field is only hidden in the UI, never dropped from the config),
    // so an orphaned spacer from a previous session can be found and removed.
    function disabledSpacerSteps() {
        var steps = [];
        if (!spacerEnabled) steps.push({ key: 'spacerId', name: spacerName });
        if (!titleSpacerEnabled) steps.push({ key: 'titleSpacerId', name: titleSpacerName });
        if (!spacerBelowEnabled) steps.push({ key: 'spacerBelowId', name: spacerBelowName });
        return steps;
    }

    function ensureBase() {
        if (!parentId) return Promise.reject(new Error('no parent channel is configured'));
        var parent = liveChannel(parentId);
        if (!parent) return Promise.reject(new Error('configured parent channel does not exist'));
        var placementChanged = !!(state.placement && state.placement !== placementKey);
        var anchorChanged = !!(state.parentId && state.parentId !== parentId) || placementChanged;
        var prep = anchorChanged ? deleteOldBaseChannels() : Promise.resolve();
        var steps = baseLayoutSteps();
        // Relocation is a re-parent only; the createOrFindBelow chain below
        // establishes the order. Building this chain lazily also keeps its
        // rejection attached to the returned promise (no unhandled rejections
        // while deleteOldBaseChannels is still running).
        function migrateBaseChannels() {
            return steps.map(function (step) { return state[step.key]; }).reduce(function (promise, channelId) {
                return promise.then(function () {
                    var existing = liveChannel(channelId);
                    if (existing && !samePlacementParent(existing, parent)) {
                        return moveSiblingVerified(existing, parent, parent);
                    }
                    return null;
                });
            }, Promise.resolve());
        }
        // A spacer that is switched off but still present on the server is
        // removed here, so unticking the box actually takes the channel out of
        // the layout instead of leaving an orphan between the other channels.
        function removeDisabledSpacers() {
            return disabledSpacerSteps().reduce(function (promise, step) {
                return promise.then(function () {
                    var leftover = liveChannel(state[step.key]) || findExactSibling(parent, step.name);
                    if (!leftover) { state[step.key] = ''; return null; }
                    if (channelsUnder(leftover).length || squadHasClients(leftover)) {
                        log('Not removing disabled spacer "' + leftover.name() + '" — it is not empty.', 2);
                        return null;
                    }
                    log('Removing disabled spacer "' + leftover.name() + '".', 3);
                    return deleteVerified(leftover).then(function () {
                        state[step.key] = '';
                    }, function (error) {
                        log('Could not remove disabled spacer "' + leftover.name() + '": ' + error.message, 2);
                    });
                });
            }, Promise.resolve());
        }
        return prep.then(function () {
            var previous = null;
            var room = null;
            return migrateBaseChannels()
                .then(function () { return removeDisabledSpacers(); })
                .then(function () {
                    // Chain each step below its predecessor. The first step goes
                    // to the top of the placement parent (order 0); passing the
                    // parent itself as the order target is rejected by TS3, so
                    // orderBelow() maps that case to 0.
                    return steps.reduce(function (promise, step) {
                        return promise.then(function () {
                            var below = previous || parent;
                            return createOrFindBelow(parent, step.name, below).then(function (channel) {
                                state[step.key] = idOf(channel);
                                if (step.power) setJoinPower(channel, step.power, step.name);
                                if (step.key === 'commandRoomId') room = channel;
                                previous = channel;
                                return channel;
                            });
                        });
                    }, Promise.resolve());
                }).then(function () {
                    state.parentId = parentId;
                    state.placement = placementKey;
                    saveState();
                    return room || commandRoom();
                });
        });
    }

    function commandRoom() {
        var parent = liveChannel(parentId);
        if (!parent) return null;
        return liveChannel(state.commandRoomId) || findExactSibling(parent, commandRoomName);
    }

    // Join-power defaults for the fleet hierarchy. Uses the same permission
    // API as other SinusBot scripts: channel.addPermission(name) -> setValue
    // -> save, delayed slightly so the channel is fully ready on the server.
    var TITLE_SPACER_JOIN_POWER = 75;
    var SQUAD_DIVISION_JOIN_POWER = 10;
    var COMMAND_ROOM_JOIN_POWER = 65;
    function setJoinPower(channel, power, label) {
        if (!channel || typeof channel.addPermission !== 'function') return Promise.resolve();
        return delay(JOIN_POWER_DELAY_MS).then(function () {
            try {
                var live = liveChannel(idOf(channel));
                if (!live) return null;
                var permission = live.addPermission('i_channel_needed_join_power');
                permission.setValue(power);
                permission.save();
                log('Set join power ' + power + ' on "' + live.name() + '".', 5);
            } catch (e) {
                log('Could not set join power ' + power + ' on "' + (label || idOf(channel)) + '": ' + e.message, 2);
            }
            return null;
        });
    }

    function ensureSquad(parent, name) {
        return createOrFind(parent, name).then(function (channel) {
            if (state.squadIds.indexOf(idOf(channel)) === -1) state.squadIds.push(idOf(channel));
            setJoinPower(channel, SQUAD_DIVISION_JOIN_POWER, name);
            return channel;
        });
    }

    function squadHasClients(channel) {
        if (channel.getClientCount) return channel.getClientCount() > 0;
        return channel.getClients && channel.getClients().length > 0;
    }

    // ---- Channel admin handover -------------------------------------------
    // The first person in a squad gets the configured channel group; when they
    // leave, the group is taken back so the next arrival can be made admin.
    // Driven by a reconcile pass (not only by clientMove) so a missed event or
    // a bot restart still converges on the right owner.
    function clientsIn(channel) {
        if (!channel || typeof channel.getClients !== 'function') return [];
        var list;
        try { list = channel.getClients() || []; } catch (e) { return []; }
        // The bot itself must never be awarded admin, and neither must a
        // query client (type 0) that the server lists in the channel.
        return list.filter(function (client) {
            if (!client) return false;
            if (client.isSelf && client.isSelf()) return false;
            if (typeof client.type === 'function' && client.type() === 0) return false;
            return true;
        });
    }

    // TS3 client ids increase with every connection, so the lowest id in a
    // channel is the person who arrived first. That makes "the first person"
    // a deterministic choice on a reconcile pass, where the arrival order is
    // no longer observable.
    function earliestClient(clients) {
        return clients.slice().sort(function (a, b) {
            var aId = parseInt(idOf(a), 10);
            var bId = parseInt(idOf(b), 10);
            if (!isNaN(aId) && !isNaN(bId) && aId !== bId) return aId - bId;
            return idOf(a).localeCompare(idOf(b));
        })[0];
    }

    function managedForAdmin() {
        var room = commandRoom();
        if (!room) return [];
        var result = [];
        channelsUnder(room).forEach(function (channel) {
            if (isSquadName(channel.name()) || (squadAdminAlsoDivisions && isDivisionChannel(channel))) result.push(channel);
        });
        if (state.divisionModeActive) {
            discoverFleet(liveChannel(parentId), room).divisions.forEach(function (division) {
                channelsUnder(division).forEach(function (child) {
                    if (isSquadName(child.name())) result.push(child);
                });
            });
        }
        return result;
    }

    // ChannelGroup objects are wrappers in most backends, but a plain object
    // with an id field is equally valid; read the id defensively.
    function channelGroupIdOf(group) {
        if (!group) return '';
        if (typeof group.id === 'function') return String(group.id());
        if (group.id !== undefined) return String(group.id);
        return '';
    }

    // The API is Channel.setChannelGroup(client, group); passing null removes
    // the channel group from that client. It is verified rather than assumed:
    // setChannelGroup can return without throwing and still do nothing.
    function setChannelAdmin(channel, client, group) {
        if (!channel || typeof channel.setChannelGroup !== 'function' || !client) return false;
        try {
            if (channel.setChannelGroup(client, group) === false) return false;
        } catch (e) {
            log('Could not ' + (group ? 'grant' : 'revoke') + ' channel admin in "' + channel.name() + '" for ' + (client.name ? client.name() : idOf(client)) + ': ' + e.message, 2);
            return false;
        }
        return true;
    }

    // The client currently holding channel admin in a channel is stored as
    // { id, previous } where `previous` is the channel group id the client held
    // BEFORE the award ('' when it had none). On leaving, that group is put
    // back instead of stripping the client bare.
    function adminRecord(channelId) {
        var raw = state.squadAdmins[channelId];
        if (!raw) return null;
        // Written by an earlier version of this feature as a bare client id.
        if (typeof raw === 'string') return { id: raw, previous: '' };
        return { id: raw.id, previous: raw.previous === undefined ? '' : raw.previous };
    }

    // The channel group a client is in right now, as a channel group object
    // (null when they have none). Needed before overwriting it.
    function currentChannelGroup(client) {
        if (!client || typeof client.getChannelGroup !== 'function') return null;
        try { return client.getChannelGroup() || null; } catch (e) { return null; }
    }

    // Hand the group to the first client in the channel, unless someone who
    // is still in the channel already holds it.
    function awardChannelAdmin(channel) {
        if (!squadAdminEnabled) return;
        var id = idOf(channel);
        var clients = clientsIn(channel);
        var record = adminRecord(id);
        if (record && clients.some(function (c) { return idOf(c) === record.id; })) return;
        if (!clients.length) { delete state.squadAdmins[id]; return; }
        // The recorded admin is gone from the channel but others moved in, so
        // the handover has to be a real hand-over: put the leaver's own group
        // back first, otherwise they keep channel admin on a channel they have
        // left and the new admin is only half privileged.
        if (record) revokeChannelAdmin(channel);
        var client = earliestClient(clients);
        if (!client) return;
        var group = backend.getChannelGroupByID ? backend.getChannelGroupByID(squadAdminGroupId) : null;
        if (!group || !channelGroupIdOf(group)) {
            log('Channel admin skipped for "' + channel.name() + '": channel group ' + squadAdminGroupId + ' does not exist on this server.', 2);
            return;
        }
        // Remember what they had BEFORE the overwrite - that is what gets
        // restored when they leave. A client who already holds the admin group
        // is remembered as holding no other group, so leaving them with none is
        // correct rather than a silent downgrade.
        var before = currentChannelGroup(client);
        var beforeId = channelGroupIdOf(before);
        if (beforeId === String(squadAdminGroupId)) beforeId = '';
        if (!setChannelAdmin(channel, client, group)) {
            delete state.squadAdmins[id];
            return;
        }
        state.squadAdmins[id] = { id: idOf(client), previous: beforeId };
        log('Gave channel admin (group ' + squadAdminGroupId + ') in "' + channel.name() + '" to ' + (client.name ? client.name() : idOf(client))
            + (beforeId ? '; will return to channel group ' + beforeId + ' on leaving.' : ' (they had no channel group before).'), 3);
    }

    // Put the leaver back on the channel group they held before the award. A
    // client that has gone offline cannot be modified through the API, so the
    // stored owner is dropped either way - the next arrival is awarded the
    // group regardless of what happened to the previous one.
    function revokeChannelAdmin(channel) {
        var id = idOf(channel);
        var record = adminRecord(id);
        if (!record) return;
        delete state.squadAdmins[id];
        var client = null;
        if (typeof backend.getClients === 'function') {
            var all = backend.getClients() || [];
            for (var i = 0; i < all.length; i++) {
                if (idOf(all[i]) === record.id) { client = all[i]; break; }
            }
        }
        if (!client) {
            log('Channel admin in "' + channel.name() + '" was held by an offline client (' + record.id + '); the stored owner was cleared.', 4);
            return;
        }
        // Restore their own group. '' means they had none, which is expressed
        // to the API as null (no channel group).
        var restore = null;
        if (record.previous && backend.getChannelGroupByID) restore = backend.getChannelGroupByID(record.previous);
        if (record.previous && !restore) {
            log('Could not restore channel group ' + record.previous + ' on ' + (client.name ? client.name() : idOf(client))
                + ' (it no longer exists on this server); leaving them without a channel group instead.', 2);
            restore = null;
        }
        if (!setChannelAdmin(channel, client, restore)) return;
        log('Restored ' + (client.name ? client.name() : idOf(client)) + ' in "' + channel.name() + '" to '
            + (record.previous ? 'channel group ' + record.previous + '.' : 'no channel group (they had none before).'), 3);
    }

    function reconcileChannelAdmins() {
        if (!squadAdminEnabled) {
            // Feature switched off: drop the bookkeeping, but do not start
            // stripping rights from clients - the user may re-enable it.
            if (Object.keys(state.squadAdmins).length) {
                state.squadAdmins = {};
                saveState();
            }
            return Promise.resolve();
        }
        var channels = managedForAdmin();
        // Forget channels that no longer exist or are no longer managed.
        Object.keys(state.squadAdmins).forEach(function (id) {
            var stillManaged = channels.some(function (c) { return idOf(c) === id; });
            if (!stillManaged) delete state.squadAdmins[id];
        });
        return channels.reduce(function (promise, channel) {
            return promise.then(function () {
                if (clientsIn(channel).length) awardChannelAdmin(channel);
                else revokeChannelAdmin(channel);
            });
        }, Promise.resolve()).then(function () { saveState(); });
    }

    function capacitySquadName(parent, index, divisionNumberValue) {
        var labels = standardNames.concat(fallbackNames);
        return squadName(divisionNumberValue, labels[index] || ('Squad ' + (index + 1)));
    }

    function channelIdSort(a, b) {
        var aId = parseInt(idOf(a), 10);
        var bId = parseInt(idOf(b), 10);
        if (!isNaN(aId) && !isNaN(bId)) return aId - bId;
        return idOf(a).localeCompare(idOf(b));
    }

    function squadLabelIndex(channel) {
        var label = squadLabel(channel.name());
        var index = standardNames.indexOf(label);
        return index === -1 ? standardNames.length + fallbackNames.indexOf(label) : index;
    }

    // squads: the channels to (re)name. Surplus empty squads that are about to
    // be deleted are deliberately left out - naming them and deleting them one
    // cycle later is pure churn. They still reserve their current name.
    function normalizeSquadSlots(parent, divisionNumberValue, squads) {
        var allChildNames = {};
        channelsUnder(parent).forEach(function (child) { allChildNames[child.name()] = true; });
        var occupied = squads.filter(squadHasClients).sort(function (a, b) {
            return squadLabelIndex(a) - squadLabelIndex(b) || channelIdSort(a, b);
        });
        var empty = squads.filter(function (channel) { return !squadHasClients(channel); }).sort(channelIdSort);
        var ordered = occupied.concat(empty);
        var usedLabels = {};
        var assignments = [];
        ordered.forEach(function (channel, index) {
            var labels = standardNames.concat(fallbackNames);
            var label = squadLabel(channel.name());
            if (squadHasClients(channel)) {
                // Occupied channels keep their designation label, but their
                // division prefix is corrected: TS3 accepts renames of occupied
                // channels, so folding a division must renumber the prefix.
                // If the label is already claimed by an earlier occupied squad,
                // fall back to the first free standard label.
                var occupiedLabel = label;
                var stuck = /__FleetManagerRename_\d+/i.test(channel.name());
                if (stuck || usedLabels[occupiedLabel]) {
                    var foundFree = false;
                    for (var j = 0; j < labels.length; j++) {
                        var occCandidate = labels[j];
                        var occName = squadName(divisionNumberValue, occCandidate);
                        if (!usedLabels[occCandidate] && !allChildNames[occName]) { occupiedLabel = occCandidate; foundFree = true; break; }
                    }
                    if (!foundFree) occupiedLabel = 'Squad ' + (index + 1);
                }
                usedLabels[occupiedLabel] = true;
                var occupiedTarget = squadName(divisionNumberValue, occupiedLabel);
                assignments.push({ channel: channel, target: occupiedTarget, renameAllowed: occupiedTarget !== channel.name() });
                return;
            }
            {
                label = null;
                for (var i = 0; i < labels.length; i++) {
                    var candidate = labels[i];
                    var candidateName = squadName(divisionNumberValue, candidate);
                    if (!usedLabels[candidate] && (!allChildNames[candidateName] || squadLabel(channel.name()) === candidate)) {
                        label = candidate;
                        break;
                    }
                }
            }
            if (!label) label = 'Squad ' + (index + 1);
            usedLabels[label] = true;
            assignments.push({ channel: channel, target: squadName(divisionNumberValue, label), renameAllowed: true });
        });
        var result = Promise.resolve();
        assignments.forEach(function (item) {
            if (!item.renameAllowed) return;
            result = result.then(function () {
                if (item.channel.name() === item.target || squadHasClients(item.channel)) return null;
                var temporary = '__FleetManagerRename_' + idOf(item.channel);
                return setNameVerified(item.channel, temporary).catch(function (error) {
                    log('Temporary rename of ' + idOf(item.channel) + ' skipped: ' + error.message, 2);
                });
            });
        });
        assignments.forEach(function (item) {
            if (!item.renameAllowed) return;
            result = result.then(function () {
                if (item.channel.name() === item.target) return null;
                // Final-name phase: attempt even when occupied. Some TS3 setups
                // allow renaming occupied channels; if the server refuses, the
                // catch keeps the chain alive and the next cycle retries.
                return setNameVerified(item.channel, item.target).catch(function (error) {
                    log('Rename of ' + idOf(item.channel) + ' deferred: ' + error.message, 4);
                });
            });
        });
        return result;
    }

    // Every managed parent has capacity for MAX_SQUADS occupied squads plus one spare.
    function reconcileSquadCapacity(parent, divisionNumberValue) {
        var squads = channelsUnder(parent).filter(function (channel) { return isSquadName(channel.name()); });
        // Decide the keep/drop split BEFORE naming anything. A squad that is
        // about to be deleted keeps its current name; renaming it first (what
        // the division fold used to do, producing a "Squad Charlie" that
        // vanished a second later) is pure churn.
        var occupiedSquads = squads.filter(squadHasClients);
        // Keep/drop is decided by channel id, never by the current label: the
        // keeper is renamed right afterwards, so a label-based choice would
        // flip on the next cycle (rename -> different order -> rename again).
        // The oldest empty squads are the keepers; freshly created ones go
        // first when capacity shrinks.
        var empty = squads.filter(function (channel) { return !squadHasClients(channel); }).sort(channelIdSort);
        var keepEmpty = occupiedSquads.length < maxSquads ? 1 : 0;
        var excess = Math.max(0, empty.length - keepEmpty);
        var keep = empty.slice(0, Math.max(0, empty.length - excess));
        var drop = empty.slice(Math.max(0, empty.length - excess));
        return normalizeSquadSlots(parent, divisionNumberValue, occupiedSquads.concat(keep)).then(function () {
            squads = channelsUnder(parent).filter(function (channel) { return isSquadName(channel.name()); });
            var occupied = squads.filter(squadHasClients).length;
            var targetCount = Math.min(maxSquads, occupied) + keepEmpty;
            var needed = Math.max(0, targetCount - squads.length);
            var result = Promise.resolve();
            for (var i = 0; i < needed; i++) {
                (function (slot) {
                    result = result.then(function () {
                        return ensureSquad(parent, capacitySquadName(parent, occupied + slot, divisionNumberValue));
                    });
                }(i));
            }
            // Surplus empty squads, highest end first, reusing the split decided
            // above so the set matches the ones that were left unnamed.
            drop.slice().reverse().forEach(function (channel) {
                var id = idOf(channel);
                if (!state.emptySince[id]) {
                    state.emptySince[id] = Date.now();
                    log('Scheduling excess empty squad "' + channel.name() + '" (id=' + id + ') for deletion in ' + squadDeleteDelay + ' seconds.', 4);
                }
                if (Date.now() - state.emptySince[id] >= squadDeleteDelay * 1000) {
                    result = result.then(function () {
                        if (squadHasClients(channel)) return channel;
                        return deleteVerified(channel).then(function () {
                            delete state.emptySince[id];
                            log('Deleted excess empty squad "' + channel.name() + '" (id=' + id + ').', 4);
                        });
                    });
                }
            });
            // Keep timers for the channels selected for deletion. Clear timers
            // only for the channels being retained.
            keep.forEach(function (channel) {
                delete state.emptySince[idOf(channel)];
            });
            return result;
        });
    }

    // A division is occupied when the division channel itself or any of its
    // squad subchannels holds a client. The fleet keeps exactly ONE unoccupied
    // division in reserve, the same way each division keeps one spare squad.
    function divisionOccupied(division) {
        if (squadHasClients(division)) return true;
        return channelsUnder(division).some(function (child) {
            return isSquadName(child.name()) && squadHasClients(child);
        });
    }

    function reconcileDivisionCapacity(room) {
        if (!state.divisionModeActive) return Promise.resolve();
        var divisions = discoverFleet(liveChannel(parentId), room).divisions;
        if (!divisions.length) return Promise.resolve();
        var occupied = divisions.filter(divisionOccupied);
        var highestOccupied = occupied.reduce(function (n, division) { return Math.max(n, divisionNumber(division)); }, 0);
        // One spare is always kept ready behind the highest occupied division.
        var required = Math.min(MAX_DIVISIONS, highestOccupied + 1);
        var existing = {};
        divisions.forEach(function (division) { existing[divisionNumber(division)] = true; });
        var missing = [];
        for (var n = 1; n <= required; n++) {
            if (!existing[n]) missing.push(n);
        }
        var result = Promise.resolve();
        if (missing.length) {
            log('Creating division(s) ' + missing.join(', ') + ' to keep one spare behind Division ' + highestOccupied + '.', 4);
        }
        missing.forEach(function (number) {
            result = result.then(function () {
                if (number > MAX_DIVISIONS) {
                    log('Not creating Division ' + number + ': the limit of ' + MAX_DIVISIONS + ' divisions is reached.', 2);
                    return null;
                }
                return createOrFind(room, divisionName(number)).then(function (division) {
                    setJoinPower(division, SQUAD_DIVISION_JOIN_POWER, divisionName(number));
                    delete state.divisionEmptySince[idOf(division)];
                    log('Created spare division "' + division.name() + '" (id=' + idOf(division) + ').', 4);
                    // The spare must be joinable, so give it a squad as well.
                    return reconcileSquadCapacity(division, number);
                });
            });
        });
        return result.then(function () {
            // Re-read: creation may have changed what is empty.
            var fresh = discoverFleet(liveChannel(parentId), room).divisions;
            var spare = fresh.filter(function (division) { return !divisionOccupied(division); });
            // More than one spare: delete the highest numbered one first.
            spare.sort(function (a, b) { return divisionNumber(b) - divisionNumber(a); });
            var excess = Math.max(0, spare.length - 1);
            var chain = Promise.resolve();
            spare.slice(0, excess).forEach(function (division) {
                chain = chain.then(function () {
                    var id = idOf(division);
                    if (divisionOccupied(division)) {
                        delete state.divisionEmptySince[id];
                        return null;
                    }
                    if (!state.divisionEmptySince[id]) {
                        state.divisionEmptySince[id] = Date.now();
                        log('Scheduling surplus empty division "' + division.name() + '" (id=' + id + ') for deletion in ' + divisionDeleteDelay + ' seconds.', 4);
                    }
                    if (Date.now() - state.divisionEmptySince[id] < divisionDeleteDelay * 1000) return null;
                    return clearSubtree(division).then(function (occupiedChildren) {
                        if (occupiedChildren.length || divisionOccupied(division)) {
                            log('Keeping division "' + division.name() + '" — it is no longer empty (' + occupiedChildren.join(', ') + ').', 2);
                            delete state.divisionEmptySince[id];
                            return null;
                        }
                        return deleteVerified(division).then(function () {
                            delete state.divisionEmptySince[id];
                            state.divisionIds = state.divisionIds.filter(function (entry) { return entry !== id; });
                            log('Deleted surplus empty division "' + division.name() + '".', 4);
                        });
                    });
                });
            });
            // Anything not scheduled for deletion is a keeper: drop its timer.
            spare.slice(excess).forEach(function (division) { delete state.divisionEmptySince[idOf(division)]; });
            return chain;
        }).then(function () {
            state.divisionIds = discoverFleet(liveChannel(parentId), room).divisions.map(idOf);
            saveState();
        });
    }

    function reconcileAllSquadCapacity(room) {
        // Divisions are provisioned first so a freshly created spare division
        // gets its squad in the same pass.
        var prepare = state.divisionModeActive ? reconcileDivisionCapacity(room) : Promise.resolve();
        return prepare.then(function () {
            var parents = [];
            if (state.divisionModeActive) {
                discoverFleet(liveChannel(parentId), room).divisions.forEach(function (division) {
                    parents.push({ channel: division, number: divisionNumber(division) || 1 });
                });
            } else {
                // Plain mode: squads in the Command Room carry no division prefix.
                parents.push({ channel: room, number: 0 });
            }
            return parents.reduce(function (promise, item) {
                return promise.then(function () { return reconcileSquadCapacity(item.channel, item.number); });
            }, Promise.resolve());
        }).then(function () {
            // Channel admin is settled after capacity, so a squad that was
            // just created or renamed is in its final shape first.
            return reconcileChannelAdmins();
        }).then(function () { saveState(); });
    }

    function onCommandRoom() {
        return ensureBase().then(function (room) {
            return reconcileSquadCapacity(room, 0);
        }).then(function () {
            state.active = true;
            saveState();
            log('Fleet System is active.', 3);
        });
    }

    function moveCommandRoomSquadsToDivision(room, division) {
        // Take a fresh live snapshot here. The existing-divisions path used to skip
        // this migration entirely and only reconciled the divisions.
        var roomSquads = channelsUnder(room).filter(function (channel) {
            return isSquadName(channel.name());
        });
        return normalizeSquadSlots(room, 1, roomSquads).then(function () {
            roomSquads = channelsUnder(room).filter(function (channel) { return isSquadName(channel.name()); });
            // Same chaining as the fold: occupied squads first, then each
            // channel directly below its predecessor, so arrival order never
            // decides the layout.
            var ordered = roomSquads.slice().sort(function (a, b) {
                var occ = (squadHasClients(b) - squadHasClients(a));
                if (occ) return occ;
                return squadLabel(a.name()).toLowerCase().localeCompare(squadLabel(b.name()).toLowerCase()) || channelIdSort(a, b);
            });
            var previous = null;
            return ordered.reduce(function (promise, squad) {
                return promise.then(function () {
                    var order = previous ? orderBelow(division, previous) : 0;
                    return moveVerified(squad, division, order).then(function (moved) {
                        previous = moved;
                        return moved;
                    });
                });
            }, Promise.resolve());
        });
    }

    function divisionOn() {
        return ensureBase().then(function (room) {
            state.active = true;
            var current = discoverFleet(liveChannel(parentId), room);
            if (current.divisions.length >= 2) {
                state.divisionModeActive = true;
                state.divisionIds = current.divisions.map(idOf);
                var existingD1 = liveChannel(state.divisionIds[0]) || current.divisions[0];
                var existingD2 = liveChannel(state.divisionIds[1]) || current.divisions[1];
                if (!existingD1 || !existingD2) return Promise.reject(new Error('existing divisions could not be resolved'));
                return moveCommandRoomSquadsToDivision(room, existingD1).then(function () {
                    return reconcileSquadCapacity(existingD1, divisionNumber(existingD1) || 1);
                }).then(function () {
                    return reconcileSquadCapacity(existingD2, divisionNumber(existingD2) || 2);
                }).then(function () {
                    saveState();
                    return room;
                });
            }
            // Activation creates only the divisions the current occupancy
            // justifies. With an empty server that is Division 1 alone: the
            // spare behind the highest occupied division is created by
            // reconcileDivisionCapacity the moment it is actually needed,
            // so we never build a division just to prune it again seconds
            // later. Squads still in the Command Room (possibly occupied)
            // are moved into Division 1 first, so the decision is made on
            // the real post-move occupancy.
            return createOrFind(room, divisionName(1)).then(function (d1) {
                setJoinPower(d1, SQUAD_DIVISION_JOIN_POWER, divisionName(1));
                state.divisionIds = [idOf(d1)];
                return d1;
            }).then(function (d1) {
                return moveCommandRoomSquadsToDivision(room, d1);
            }).then(function () {
                state.divisionModeActive = true;
                var d1 = liveChannel(state.divisionIds[0]);
                if (!d1) return Promise.reject(new Error('division channels could not be resolved after creation'));
                return reconcileSquadCapacity(d1, 1).then(function () {
                    return reconcileDivisionCapacity(room);
                }).then(function () {
                    log('Division mode activated with ' + discoverFleet(liveChannel(parentId), room).divisions.length + ' division(s).', 3);
                });
            }).then(function () {
                saveState();
            });
        });
    }

    function divisionOff() {
        return ensureBase().then(function (room) {
            log('Starting division off migration.', 3);
            var found = discoverFleet(liveChannel(parentId), room);
            found.divisions.forEach(function (division) { log('Found ' + division.name() + ' (id=' + idOf(division) + ').', 4); });
            found.squads.forEach(function (item) { log('Found squad "' + item.channel.name() + '" (id=' + idOf(item.channel) + ').', 4); });
            var used = {};
            found.squads.forEach(function (item) {
                if (squadHasClients(item.channel)) used[squadLabel(item.channel.name())] = true;
            });
            // Only the squads that survive the fold need a plain-mode name.
            // Folding two divisions moves every squad into the Command Room,
            // where the capacity rules keep one spare and delete the rest -
            // naming those extras first produced phantom channels (a
            // "Squad Charlie" that vanished a second later).
            var occupiedCount = found.squads.filter(function (item) { return squadHasClients(item.channel); }).length;
            var keepEmpty = occupiedCount < maxSquads ? 1 : 0;
            var emptySeen = 0;
            // Oldest empty squad first: the same stable order the capacity
            // rules use, so the keeper is not renamed away next cycle.
            var ordered = found.squads.slice().sort(function (a, b) {
                return (squadHasClients(b.channel) - squadHasClients(a.channel)) || channelIdSort(a.channel, b.channel);
            });
            var assignments = ordered.map(function (item, index) {
                if (squadHasClients(item.channel)) {
                    // Occupied squads keep their label but drop the division
                    // prefix (plain mode); TS3 accepts renames of occupied
                    // channels.
                    var occLabel = squadLabel(item.channel.name());
                    if (/__FleetManagerRename_\d+/i.test(item.channel.name())) occLabel = 'Squad ' + (index + 1);
                    return { channel: item.channel, name: squadName(0, occLabel), renameAllowed: true };
                }
                emptySeen++;
                if (emptySeen > keepEmpty) {
                    // Surplus: keep the current name, let the capacity rules
                    // delete it after the squad delete delay.
                    return { channel: item.channel, name: item.channel.name(), renameAllowed: false };
                }
                return { channel: item.channel, name: targetSquadName(squadLabel(item.channel.name()), used, index), renameAllowed: true };
            });
            return assignments.reduce(function (promise, item) {
                return promise.then(function () {
                    if (!item.renameAllowed) return item.channel;
                    return setNameVerified(item.channel, item.name).catch(function (error) {
                        log('Rename of ' + idOf(item.channel) + ' skipped: ' + error.message, 2);
                        return item.channel;
                    });
                });
            }, Promise.resolve()).then(function () {
                // Move the squads into the room chained by CHANNEL_ORDER: each
                // one directly below its predecessor. Moving them all with
                // order 0 (top) stacks them in reverse arrival order, which is
                // how the empty spare ended up ABOVE the occupied squad after
                // a fold. `ordered` puts occupied squads first.
                var previous = null;
                return assignments.reduce(function (promise, item) {
                    return promise.then(function () {
                        var order = previous ? orderBelow(room, previous) : 0;
                        return moveVerified(item.channel, room, order).then(function (moved) {
                            previous = moved;
                            return moved;
                        });
                    });
                }, Promise.resolve());
            }).then(function () {
                var rescanned = discoverFleet(liveChannel(parentId), room);
                var nonEmpty = rescanned.divisions.filter(function (division) {
                    var remaining = channelsUnder(division).filter(function (child) { return isSquadName(child.name()); });
                    if (remaining.length) log('Refusing to delete non-empty ' + division.name() + '.', 2);
                    return remaining.length > 0;
                });
                if (nonEmpty.length) return Promise.reject(new Error('one or more divisions are not empty'));
                if (!deleteDivisionsOnOff) {
                    log('Keeping empty division channels because cleanup mode is configured to keep them.', 3);
                    return true;
                }
                return rescanned.divisions.reduce(function (promise, division) {
                    return promise.then(function () { return deleteVerified(division); });
                }, Promise.resolve());
            }).then(function () {
                state.divisionModeActive = false;
                state.divisionIds = [];
                state.squadIds = channelsUnder(room).filter(function (channel) { return isSquadName(channel.name()); }).map(idOf);
                return reconcileSquadCapacity(room, 0).then(function () {
                    saveState();
                    log('Division mode deactivated.', 3);
                    return reconcile();
                });
            });
        });
    }

    function divisionPlus() {
        return ensureBase().then(function (room) {
            var found = discoverFleet(liveChannel(parentId), room);
            var highest = found.divisions.reduce(function (n, division) { return Math.max(n, divisionNumber(division)); }, 0);
            var number = highest + 1;
            return createOrFind(room, divisionName(number)).then(function (division) {
                setJoinPower(division, SQUAD_DIVISION_JOIN_POWER, divisionName(number));
                state.divisionModeActive = true;
                state.divisionIds.push(idOf(division));
                saveState();
                return ensureSquad(division, '[D' + number + '] Squad Alpha');
            });
        });
    }

    function divisionMinus() {
        return ensureBase().then(function (room) {
            var found = discoverFleet(liveChannel(parentId), room);
            if (found.divisions.length < 2) return Promise.reject(new Error('there is no removable final division'));
            var last = found.divisions[found.divisions.length - 1];
            var previous = found.divisions[found.divisions.length - 2];
            var squads = channelsUnder(last).filter(function (channel) { return isSquadName(channel.name()); });
            return squads.reduce(function (promise, squad) {
                return promise.then(function () { return moveVerified(squad, previous); });
            }, Promise.resolve()).then(function () {
                if (channelsUnder(last).filter(function (channel) { return isSquadName(channel.name()); }).length) return Promise.reject(new Error('final division is not empty'));
                return deleteVerified(last);
            }).then(function () {
                state.divisionIds = state.divisionIds.filter(function (id) { return id !== idOf(last); });
                return reconcileSquadCapacity(previous, divisionNumber(previous) || 1).then(saveState);
            });
        });
    }

    function fleetChannelsForOff() {
        var parent = liveChannel(parentId);
        if (!parent) return Promise.reject(new Error('configured parent channel does not exist'));
        var room = commandRoom();
        var divisions = room ? channelsUnder(room).filter(function (channel) {
            return divisionNumber(channel) || channel.name().indexOf('Division ') === 0;
        }) : [];
        var squads = [];
        divisions.forEach(function (division) {
            channelsUnder(division).filter(function (channel) { return isSquadName(channel.name()); }).forEach(function (channel) { squads.push(channel); });
        });
        if (room) channelsUnder(room).filter(function (channel) { return isSquadName(channel.name()); }).forEach(function (channel) { squads.push(channel); });
        var spacers = placementSiblings(parent).filter(function (channel) {
            return channel.name() === spacerName || channel.name() === spacerBelowName || (titleSpacerName && channel.name() === titleSpacerName);
        });
        var seen = {};
        squads = squads.filter(function (channel) { if (seen[idOf(channel)]) return false; seen[idOf(channel)] = true; return true; });
        return Promise.resolve({ parent: parent, room: room, divisions: divisions, squads: squads, spacers: spacers });
    }

    function turnOffAndDelete() {
        return fleetChannelsForOff().then(function (fleet) {
            var result = Promise.resolve();
            fleet.squads.forEach(function (squad) { result = result.then(function () { return deleteVerified(squad); }); });
            fleet.divisions.slice().reverse().forEach(function (division) {
                result = result.then(function () {
                    if (channelsUnder(division).length) return Promise.reject(new Error('cannot delete non-empty ' + division.name()));
                    return deleteVerified(division);
                });
            });
            if (fleet.room) result = result.then(function () {
                if (channelsUnder(fleet.room).length) return Promise.reject(new Error('cannot delete non-empty Command Room'));
                return deleteVerified(fleet.room);
            });
            fleet.spacers.slice().reverse().forEach(function (spacer) { result = result.then(function () { return deleteVerified(spacer); }); });
            return result.then(function () {
                state.active = false;
                state.divisionModeActive = false;
                state.commandRoomId = '';
                state.spacerId = '';
                state.spacerBelowId = '';
                state.titleSpacerId = '';
                state.divisionIds = [];
                state.squadIds = [];
                state.emptySince = {};
                state.squadAdmins = {};
                saveState();
                log('Fleet System channels removed and state reset.', 3);
            });
        });
    }

    // Run ensureBase only when the base layout does not match the currently
    // enabled steps (a channel is missing, or a spacer the user switched off
    // is still on the server); otherwise plain reconciliation. This keeps the
    // layout self-maintaining without re-moving correctly placed channels on
    // every cycle.
    function reconcileWithBase(room) {
        var parent = liveChannel(parentId);
        if (!parent) return reconcileAllSquadCapacity(room);
        var steps = baseLayoutSteps();
        var missing = steps.filter(function (step) { return !findExactSibling(parent, step.name); });
        var strays = disabledSpacerSteps().filter(function (step) { return findExactSibling(parent, step.name); });
        // When the configured anchor changed, the base channels may still be
        // valid siblings (e.g. both anchors are root channels) but ordered
        // after the OLD anchor; force a structural re-placement then. The same
        // applies when the user flips the placement mode (siblings <-> inside).
        var placementChanged = !!(state.placement && state.placement !== placementKey);
        var anchorChanged = state.parentId !== parentId || placementChanged;
        var complete = !anchorChanged && !missing.length && !strays.length;
        if (complete) return reconcileAllSquadCapacity(room);
        var reason = anchorChanged
            ? 'Anchor channel or placement mode changed; relocating fleet base (' + (placeInsideAnchor ? 'inside the anchor' : 'below the anchor') + ').'
            : (missing.length
                ? 'Base layout incomplete; missing: ' + missing.map(function (step) { return '"' + step.name + '"'; }).join(', ') + '.'
                : 'Spacers that are switched off are still present; removing: ' + strays.map(function (step) { return '"' + step.name + '"'; }).join(', ') + '.');
        log(reason, 4);
        return ensureBase().then(function (freshRoom) {
            return reconcileAllSquadCapacity(freshRoom || room);
        });
    }

    // '!fs division <number>': make the total division count match <number>.
    // Works from any state (off, plain mode, division mode): activates the
    // system, folds surplus divisions from the end, creates missing ones.
    function divisionToNumber(target) {
        if (target === 0) return divisionOff();
        return ensureBase().then(function (room) {
            state.active = true;
            saveState();
            function settle() {
                var found = discoverFleet(liveChannel(parentId), commandRoom());
                if (found.divisions.length > target) {
                    return divisionMinus().then(settle);
                }
                if (found.divisions.length < target) {
                    return divisionPlus().then(settle);
                }
                // Squads left directly in the Command Room (plain mode) move
                // into the first division so none are orphaned.
                var strays = channelsUnder(room).filter(function (channel) { return isSquadName(channel.name()); });
                var firstDivision = found.divisions[0];
                if (strays.length && firstDivision) {
                    return moveCommandRoomSquadsToDivision(room, firstDivision).then(settle);
                }
                state.divisionModeActive = true;
                state.divisionIds = found.divisions.map(idOf);
                saveState();
                return found.divisions.reduce(function (promise, division) {
                    return promise.then(function () { return reconcileSquadCapacity(division, divisionNumber(division) || 1); });
                }, Promise.resolve()).then(function () { return room; });
            }
            return settle();
        });
    }

    function reconcile() {
        if (operationRunning || !state.active || !parentId) return Promise.resolve();
        var room = commandRoom();
        if (!room) return Promise.resolve();
        state.commandRoomId = idOf(room);
        state.squadIds = channelsUnder(room).filter(function (channel) { return isSquadName(channel.name()); }).map(idOf);
        if (state.divisionModeActive) {
            state.divisionIds = discoverFleet(liveChannel(parentId), room).divisions.map(idOf);
        }
        return runExclusive('reconciliation', function () {
            return reconcileWithBase(room);
        }).catch(function (error) {
            log('Reconciliation failed: ' + error.message, 2);
        });
    }

    function cleanupEmptySquads() {
        if (operationRunning || !state.active) return;
        var room = commandRoom();
        if (!room) return;
        runExclusive('capacity reconciliation', function () {
            return reconcileWithBase(room);
        }).catch(function (error) {
            log('Capacity reconciliation failed: ' + error.message, 2);
        });
    }

    // Dedicated order check: with many quick division changes a block can end
    // up inverted between two operations (a superseded command's final sort
    // never runs, a move is refused, ...). Re-assert the managed layout on its
    // own interval, serialized through runExclusive so it never fights a
    // running operation (skipped while one is active; the operation's own
    // final sort covers that window).
    function checkChannelOrder() {
        if (operationRunning || !state.active) return;
        var room = commandRoom();
        if (!room) return;
        runExclusive('order check', sortFleetSiblings).catch(function (error) {
            // Superseded by a user command or a transient refusal: the next
            // tick retries, so a rejection here is routine and stays quiet.
            log('Order check skipped: ' + error.message, 4);
        });
    }

    function sortFleetSiblings() {
        var room = commandRoom();
        if (!room) return Promise.resolve();
        var result = sortManagedSiblings(room);
        if (state.divisionModeActive) {
            discoverFleet(liveChannel(parentId), room).divisions.forEach(function (division) {
                result = result.then(function () { return sortManagedSiblings(division); });
            });
        }
        return result;
    }

    function runExclusive(label, action) {
        if (operationRunning) {
            // Remember only the latest command - the current operation
            // will execute it immediately when it finishes. No FIFO queue,
            // no polling. If a previous command is already pending, reject
            // it first so its promise settles rather than hanging forever.
            if (pendingAction && pendingReject) {
                var oldReject = pendingReject;
                pendingAction = null;
                pendingReject = null;
                oldReject(new Error('command superseded by a newer command'));
            }
            pendingAction = { label: label, action: action };
            return new Promise(function (resolve, reject) {
                pendingResolve = resolve;
                pendingReject = reject;
            });
        }
        operationRunning = true;
        sortingSuspended = true;
        log('Operation started: ' + label + '.', 4);
        return Promise.resolve().then(action).then(function (result) {
            sortingSuspended = false;
            return sortFleetSiblings().then(function () {
                operationRunning = false;
                if (pendingAction) {
                    var next = pendingAction;
                    pendingAction = null;
                    var r = pendingResolve;
                    pendingResolve = null;
                    var j = pendingReject;
                    pendingReject = null;
                    runExclusive(next.label, next.action).then(function () {
                        if (r) r();
                    }, function (nextError) {
                        if (j) j(nextError);
                    });
                }
                return result;
            }, function (sortError) {
                operationRunning = false;
                if (pendingAction) {
                    var next = pendingAction;
                    pendingAction = null;
                    var r = pendingResolve;
                    pendingResolve = null;
                    var j = pendingReject;
                    pendingReject = null;
                    runExclusive(next.label, next.action).then(function () {
                        if (r) r();
                    }, function (nextError) {
                        if (j) j(nextError);
                    });
                }
                log(label + ' final sorting failed safely: ' + sortError.message, 2);
                saveState();
                throw sortError;
            });
        }, function (error) {
            operationRunning = false;
            sortingSuspended = false;
            if (pendingAction) {
                var next = pendingAction;
                pendingAction = null;
                var r = pendingResolve;
                pendingResolve = null;
                var j = pendingReject;
                pendingReject = null;
                runExclusive(next.label, next.action).then(function () {
                    if (r) r();
                }, function (nextError) {
                    if (j) j(nextError);
                });
            }
            log(label + ' failed safely: ' + error.message, 2);
            saveState();
            throw error;
        });
    }

    function authorized(client) {
        var group = String(config.ADMIN_GROUP || '17');
        return client && (client.isSelf() || lib.client.isMemberOfOne(client, [group]));
    }

    function reply(client, text) { if (client && client.chat) client.chat(text); }

    function help(client) {
        reply(client, prefix + ' on | off | division on | division off | division <number> | + | - | help');
    }

    // Command dispatch: immediate acknowledgement so the sender knows the
    // bot is working (structural operations can take a few seconds), with
    // the result message following when the operation settles.
    var COMMANDS = {
        'on': function () { return runExclusive('on', onCommandRoom); },
        'off': function () { return runExclusive('off', turnOffAndDelete); },
        'division on': function () { return runExclusive('division on', divisionOn); },
        'division off': function () { return runExclusive('division off', divisionOff); },
        'division +': function () { return runExclusive('division +', divisionPlus); },
        'division -': function () { return runExclusive('division -', divisionMinus); }
    };

    event.on('chat', function (ev) {
        var text = String(ev.text || '').trim();
        var command = null;
        if (text === prefix + '+' || text === prefix + '-') {
            command = 'division ' + text.slice(prefix.length);
        } else if (text === prefix || text.indexOf(prefix + ' ') === 0) {
            var parsed = text.slice(prefix.length).trim().toLowerCase();
            var divisionTarget = parsed.match(/^division (\d+)$/);
            if (divisionTarget) {
                var target = parseInt(divisionTarget[1], 10);
                if (target > MAX_DIVISIONS) {
                    reply(ev.invoker || ev.client, 'Too many divisions (max ' + MAX_DIVISIONS + ').');
                    return;
                }
                log('Command "' + text + '" received (mode=' + ev.mode + ').', 2);
                var targetClient = ev.invoker || ev.client;
                if (!authorized(targetClient)) {
                    log('Command rejected: sender is not in the admin group (' + config.ADMIN_GROUP + ').', 2);
                    reply(targetClient, 'You are not authorized to use Fleet Manager.');
                    return;
                }
                reply(targetClient, 'Fleet Manager: working on "division ' + target + '"...');
                runExclusive('division ' + target, function () { return divisionToNumber(target); }).then(function () {
                    reply(targetClient, 'Fleet Manager: done.');
                }).catch(function (error) {
                    reply(targetClient, 'Fleet Manager: ' + error.message);
                });
                return;
            }
            if (parsed && COMMANDS[parsed]) command = parsed;
            else if (parsed === 'help') { help(ev.invoker || ev.client); return; }
            else if (parsed) { reply(ev.invoker || ev.client, 'Unknown command. Use ' + prefix + ' help'); return; }
            else return;
        } else return;
        log('Command "' + text + '" received (mode=' + ev.mode + ').', 2);
        var client = ev.invoker || ev.client;
        if (!authorized(client)) {
            log('Command rejected: sender is not in the admin group (' + config.ADMIN_GROUP + ').', 2);
            reply(client, 'You are not authorized to use Fleet Manager.');
            return;
        }
        reply(client, 'Fleet Manager: working on "' + command + '"...');
        COMMANDS[command]().then(function () {
            reply(client, 'Fleet Manager: done.');
        }).catch(function (error) {
            reply(client, 'Fleet Manager: ' + error.message);
        });
    });

    // Fast path for the channel-admin handover. The reconcile pass is the
    // source of truth (it survives missed events and restarts); this only
    // makes the handover feel immediate when a client enters or leaves a
    // squad. clientJoin does not fire on the TS3 backend, so movement is
    // observed through clientMove.
    var adminSettleTimer = null;
    function scheduleChannelAdminSettle() {
        if (!squadAdminEnabled || !state.active || !parentId) return;
        if (adminSettleTimer) clearTimeout(adminSettleTimer);
        // A client list can still be settling right after a move; a short
        // debounce avoids awarding admin based on a half-updated channel.
        adminSettleTimer = setTimeout(function () {
            adminSettleTimer = null;
            reconcileChannelAdmins().catch(function (error) {
                log('Channel admin handover failed safely: ' + error.message, 2);
            });
        }, 400);
    }

    event.on('clientMove', function () {
        scheduleChannelAdminSettle();
    });

    event.on('connect', function () {
        setTimeout(function () { reconcile().catch(function (error) { log('Reconciliation failed: ' + error.message, 2); }); }, 1000);
    });

    if (watchdogEnabled) {
        cleanupTimer = setInterval(cleanupEmptySquads, reconciliationInterval * 1000);
        var orderTimer = setInterval(checkChannelOrder, reconciliationInterval * 1000);
    } else {
        log('Watchdog is switched off; the fleet is only rebuilt when a command is used or the bot reconnects.', 3);
    }
    log('Loaded; using OKlib ' + (lib.general.checkVersion('1.0.6') ? 'compatible' : 'incompatible') + ' helpers. Watchdog: ' + (watchdogEnabled ? 'every ' + reconciliationInterval + 's' : 'off') + '; squad deletion: ' + squadDeleteDelay + 's; division deletion: ' + divisionDeleteDelay + 's; channel admin: ' + (squadAdminEnabled ? 'on, group ' + squadAdminGroupId + (squadAdminAlsoDivisions ? ', squads and divisions' : ', squads only') : 'off') + '; layout: ' + baseLayoutSteps().map(function (step) { return '"' + step.name + '"'; }).join(' > ') + '.', 3);
});

// Pure helper exports are intentionally not used by SinusBot; this comment documents the
// collision-safe invariant: all merged squads are assigned unique [D1] labels before moving.
