registerPlugin({
    name: 'Fleet Manager',
    version: '1.0.0',
    engine: '>= 0.13.37',
    backends: ['ts3'],
    autorun: false,
    description: 'Race-safe Fleet System channel hierarchy manager for TeamSpeak 3.',
    author: 'Fleet Manager contributors',
    vars: [
        { name: 'BOT_NAME', title: 'Command prefix name (used as !<name>)', type: 'string', defaultValue: 'fs' },
        { name: 'ADMIN_GROUP', title: 'Administrator server group ID', type: 'number', defaultValue: 17 },
        { name: 'PARENT_CHANNEL_ID', title: 'Anchor channel; Fleet Manager channels are placed below it as siblings', type: 'channel' },
        { name: 'COMMAND_ROOM_NAME', title: 'Command Room name', type: 'string', defaultValue: 'Command Room' },
        { name: 'SPACER_NAME', title: 'Spacer above Command Room', type: 'string', defaultValue: '── Fleet System ──' },
        { name: 'SPACER_BELOW_NAME', title: 'Spacer below Command Room', type: 'string', defaultValue: '━━ Fleet System ━━' },
        { name: 'DIVISION_NAMING_MODE', title: 'Division naming mode', type: 'select', options: ['number', 'pool'], defaultValue: 0 },
        { name: 'DIVISION_NAME_POOL', title: 'Division name pool (comma separated)', type: 'string', defaultValue: 'Alpha,Bravo,Charlie,Delta' },
        { name: 'DIVISION_CLEANUP_MODE', title: 'Division cleanup after division off', type: 'select', options: ['delete empty divisions', 'keep empty divisions'], defaultValue: 0 },
        { name: 'MAX_SQUADS', title: 'Maximum standard squad slots per division', type: 'number', defaultValue: 4 },
        { name: 'SQUAD_DELETE_DELAY', title: 'Empty squad delete delay (seconds)', type: 'number', defaultValue: 1 },
        { name: 'DIVISION_DELETE_DELAY', title: 'Empty division delete delay (seconds)', type: 'number', defaultValue: 1 },
        { name: 'RECONCILIATION_INTERVAL', title: 'Fleet reconciliation interval (seconds)', type: 'number', defaultValue: 2 }
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
    var spacerName = config.SPACER_NAME || '── Fleet System ──';
    var spacerBelowName = config.SPACER_BELOW_NAME || '━━ Fleet System ━━';
    var maxSquads = Math.max(1, parseInt(config.MAX_SQUADS, 10) || 4);
    var squadDeleteDelay = Math.max(1, parseInt(config.SQUAD_DELETE_DELAY, 10) || 1);
    var divisionDeleteDelay = Math.max(1, parseInt(config.DIVISION_DELETE_DELAY, 10) || 1);
    var reconciliationInterval = Math.max(1, parseInt(config.RECONCILIATION_INTERVAL, 10) || 2);
    var deleteDivisionsOnOff = !(config.DIVISION_CLEANUP_MODE === 1 || config.DIVISION_CLEANUP_MODE === '1' || config.DIVISION_CLEANUP_MODE === 'keep');
    var standardNames = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
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
            divisionIds: [],
            squadIds: [],
            emptySince: {}
        };
        value.divisionIds = Array.isArray(value.divisionIds) ? value.divisionIds : [];
        value.squadIds = Array.isArray(value.squadIds) ? value.squadIds : [];
        value.emptySince = value.emptySince || {};
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

    function siblingsOf(anchor) {
        if (!anchor) return [];
        return (backend.getChannels() || []).filter(function (channel) { return sameParent(channel, anchor); });
    }

    function findExactSibling(anchor, name) {
        var siblings = siblingsOf(anchor);
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].name() === name) return siblings[i];
        }
        return null;
    }

    function liveChannel(id) {
        return id ? backend.getChannelByID(String(id)) : null;
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function waitForChannel(id, predicate, attempts) {
        attempts = attempts || 12;
        var channel = liveChannel(id);
        if (channel && predicate(channel)) return Promise.resolve(channel);
        if (attempts <= 0) return Promise.reject(new Error('verification timeout for channel ' + id));
        return delay(250).then(function () { return waitForChannel(id, predicate, attempts - 1); });
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

    function moveSiblingVerified(channel, anchor, order) {
        var siblingParent = anchorParent(anchor);
        var target = siblingParent || 0;
        var oldParent = channel.parent ? channel.parent() : null;
        log('Moving channel "' + channel.name() + '" (id=' + idOf(channel) + ') below anchor "' + anchor.name() + '".', 4);
        try { channel.moveTo(target, order); } catch (e) { return Promise.reject(e); }
        return waitForChannel(idOf(channel), function (current) { return sameParent(current, anchor); }).then(function (current) {
            return sortManagedSiblings(oldParent).then(function () {
                return sortManagedSiblings(siblingParent).then(function () { return current; });
            });
        });
    }

    function createOrFindBelow(anchor, name, offset) {
        var existing = findExactSibling(anchor, name);
        var anchorPosition = anchor.position ? (+anchor.position() || 0) : 0;
        var targetPosition = anchorPosition + (offset || 1);
        if (existing) return moveSiblingVerified(existing, anchor, targetPosition);
        var siblingParent = anchorParent(anchor);
        // TeamSpeak can reject a create-time position as "invalid channel
        // order", especially for root-level channels. Create at the default
        // position first, then place the channel with moveTo(parent, order).
        var params = { name: name, parent: siblingParent ? idOf(siblingParent) : 0, permanent: true, codec: 4, codecQuality: 6 };
        var created;
        try { created = backend.createChannel(params); } catch (e) { return Promise.reject(e); }
        if (created && idOf(created)) {
            return waitForChannel(idOf(created), function (channel) {
                return channel.name() === name && sameParent(channel, anchor);
            }).then(function (channel) { return moveSiblingVerified(channel, anchor, targetPosition); });
        }
        return delay(300).then(function () {
            var found = findExactSibling(anchor, name);
            if (!found) return Promise.reject(new Error('created sibling channel was not returned by backend'));
            return moveSiblingVerified(found, anchor, targetPosition);
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

    function moveVerified(channel, parent) {
        log('Moving channel "' + channel.name() + '" (id=' + idOf(channel) + ') to parent ' + idOf(parent) + '.', 4);
        // SinusBot's Channel.moveTo signature is moveTo(parent, order).
        // Omitting order produces "expected more parameters" and leaves the
        // squad in the Command Room even though the operation was logged.
        try { channel.moveTo(parent, 0); } catch (e) { return Promise.reject(e); }
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
        return delay(300).then(function () {
            if (liveChannel(id)) return Promise.reject(new Error('channel ' + id + ' still exists after delete'));
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
        return /^\[D\d+\]\s+Squad\s+.+$/i.test(name) || /^__FleetManagerRename_\d+$/i.test(name);
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
        var managed = channelsUnder(parent).filter(function (channel) {
            return isSquadName(channel.name()) || isDivisionChannel(channel);
        });
        if (managed.length < 2) return Promise.resolve();
        managed.sort(function (a, b) {
            var aKey = isSquadName(a.name()) ? squadLabel(a.name()).toLowerCase() : managedSortKey(a);
            var bKey = isSquadName(b.name()) ? squadLabel(b.name()).toLowerCase() : managedSortKey(b);
            return aKey.localeCompare(bKey) || idOf(a).localeCompare(idOf(b));
        });
        var positions = managed.map(function (channel, index) {
            return channel.position ? (+channel.position() || index) : index;
        }).sort(function (a, b) { return a - b; });
        return managed.reduce(function (promise, channel, index) {
            return promise.then(function () {
                var desired = positions[index];
                var current = channel.position ? (+channel.position() || 0) : -1;
                if (current === desired) return channel;
                try { channel.moveTo(parent, desired); } catch (e) { return Promise.reject(e); }
                return waitForChannel(idOf(channel), function (updated) {
                    return updated.parent() && sameId(updated.parent(), idOf(parent));
                });
            });
        }, Promise.resolve());
    }

    function squadLabel(name) {
        var match = name.match(/^\[D\d+\]\s+Squad\s+(.+)$/i);
        return match ? match[1].trim() : name;
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
        return '[D1] Squad ' + desired;
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

    function ensureBase() {
        if (!parentId) return Promise.reject(new Error('no parent channel is configured'));
        var parent = liveChannel(parentId);
        if (!parent) return Promise.reject(new Error('configured parent channel does not exist'));
        var migration = Promise.resolve();
        [state.spacerId, state.commandRoomId, state.spacerBelowId].forEach(function (channelId) {
            var existing = liveChannel(channelId);
            if (existing && !sameParent(existing, parent)) {
                migration = migration.then(function () { return moveSiblingVerified(existing, parent, 1); });
            }
        });
        return migration.then(function () { return createOrFindBelow(parent, spacerName, 1); }).then(function (spacer) {
            state.spacerId = idOf(spacer);
            return createOrFindBelow(parent, commandRoomName, 2);
        }).then(function (commandRoomChannel) {
            state.commandRoomId = idOf(commandRoomChannel);
            return createOrFindBelow(parent, spacerBelowName, 3);
        }).then(function (spacerBelow) {
            state.spacerBelowId = idOf(spacerBelow);
            saveState();
            return commandRoom();
        });
    }

    function commandRoom() {
        var parent = liveChannel(parentId);
        if (!parent) return null;
        return liveChannel(state.commandRoomId) || findExactSibling(parent, commandRoomName);
    }

    function ensureSquad(parent, name) {
        return createOrFind(parent, name).then(function (channel) {
            if (state.squadIds.indexOf(idOf(channel)) === -1) state.squadIds.push(idOf(channel));
            return channel;
        });
    }

    function squadHasClients(channel) {
        if (channel.getClientCount) return channel.getClientCount() > 0;
        return channel.getClients && channel.getClients().length > 0;
    }

    function capacitySquadName(parent, index, divisionNumberValue) {
        var prefixNumber = divisionNumberValue || 1;
        var labels = standardNames.concat(fallbackNames);
        return '[D' + prefixNumber + '] Squad ' + (labels[index] || ('Squad ' + (index + 1)));
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

    function normalizeSquadSlots(parent, divisionNumberValue, squads) {
        var prefixNumber = divisionNumberValue || 1;
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
                // Occupied channels keep their alphabetical label, but their
                // division prefix is always normalized for the destination.
                usedLabels[label] = true;
                assignments.push({ channel: channel, target: '[D' + prefixNumber + '] Squad ' + label, renameAllowed: true });
                return;
            }
            {
                label = null;
                for (var i = 0; i < labels.length; i++) {
                    var candidate = labels[i];
                    var candidateName = '[D' + prefixNumber + '] Squad ' + candidate;
                    if (!usedLabels[candidate] && (!allChildNames[candidateName] || squadLabel(channel.name()) === candidate)) {
                        label = candidate;
                        break;
                    }
                }
            }
            if (!label) label = 'Squad ' + (index + 1);
            usedLabels[label] = true;
            assignments.push({ channel: channel, target: '[D' + prefixNumber + '] Squad ' + label, renameAllowed: true });
        });
        var result = Promise.resolve();
        assignments.forEach(function (item) {
            if (item.renameAllowed && item.channel.name() !== item.target) {
                var temporary = '__FleetManagerRename_' + idOf(item.channel);
                result = result.then(function () { return setNameVerified(item.channel, temporary); });
            }
        });
        assignments.forEach(function (item) {
            if (item.renameAllowed && item.channel.name() !== item.target) {
                result = result.then(function () { return setNameVerified(item.channel, item.target); });
            }
        });
        return result;
    }

    // Every managed parent has capacity for MAX_SQUADS occupied squads plus one spare.
    function reconcileSquadCapacity(parent, divisionNumberValue) {
        var squads = channelsUnder(parent).filter(function (channel) { return isSquadName(channel.name()); });
        return normalizeSquadSlots(parent, divisionNumberValue, squads).then(function () {
            squads = channelsUnder(parent).filter(function (channel) { return isSquadName(channel.name()); });
            var occupied = squads.filter(squadHasClients).length;
            var empty = squads.filter(function (channel) { return !squadHasClients(channel); }).sort(channelIdSort);
            // Preserve the alphabetically earliest empty slot and remove from
            // the alphabetically last end first, minimizing future renames.
            empty.sort(function (a, b) {
                return squadLabel(a.name()).toLowerCase().localeCompare(squadLabel(b.name()).toLowerCase()) || channelIdSort(a, b);
            });
            var keepEmpty = occupied < maxSquads ? 1 : 0;
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
            var excess = Math.max(0, empty.length - keepEmpty);
            empty.slice(Math.max(0, empty.length - excess)).reverse().forEach(function (channel) {
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
            // only for the alphabetically earliest channels being retained.
            empty.slice(0, Math.max(0, empty.length - excess)).forEach(function (channel) {
                delete state.emptySince[idOf(channel)];
            });
            return result;
        });
    }

    function reconcileAllSquadCapacity(room) {
        var parents = [];
        if (state.divisionModeActive) {
            discoverFleet(liveChannel(parentId), room).divisions.forEach(function (division) {
                parents.push({ channel: division, number: divisionNumber(division) || 1 });
            });
        } else {
            parents.push({ channel: room, number: 1 });
        }
        return parents.reduce(function (promise, item) {
            return promise.then(function () { return reconcileSquadCapacity(item.channel, item.number); });
        }, Promise.resolve()).then(function () { saveState(); });
    }

    function onCommandRoom() {
        return ensureBase().then(function (room) {
            return reconcileSquadCapacity(room, 1);
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
            return roomSquads.reduce(function (promise, squad) {
            return promise.then(function () {
                return moveVerified(squad, division);
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
            var createdD1;
            var createdD2;
            return createOrFind(room, divisionName(1)).then(function (d1) {
                createdD1 = d1;
                return createOrFind(room, divisionName(2)).then(function (d2) {
                    createdD2 = d2;
                    state.divisionIds = [idOf(d1), idOf(d2)];
                    return d1;
                });
            }).then(function (d1) {
                return moveCommandRoomSquadsToDivision(room, d1);
            }).then(function () {
                var d2 = liveChannel(state.divisionIds[1]);
                state.divisionModeActive = true;
                var d1 = liveChannel(state.divisionIds[0]) || createdD1;
                d2 = d2 || createdD2;
                if (!d1 || !d2) return Promise.reject(new Error('division channels could not be resolved after creation'));
                return reconcileSquadCapacity(d1, 1).then(function () {
                    return reconcileSquadCapacity(d2, 2);
                });
            }).then(function () {
                saveState();
                log('Division mode activated.', 3);
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
            var assignments = found.squads.map(function (item, index) {
                if (squadHasClients(item.channel)) {
                    return { channel: item.channel, name: '[D1] Squad ' + squadLabel(item.channel.name()), renameAllowed: true };
                }
                return { channel: item.channel, name: targetSquadName(squadLabel(item.channel.name()), used, index), renameAllowed: true };
            });
            return assignments.reduce(function (promise, item) {
                return promise.then(function () {
                    if (!item.renameAllowed) return item.channel;
                    return setNameVerified(item.channel, item.name);
                });
            }, Promise.resolve()).then(function () {
                return assignments.reduce(function (promise, item) {
                    return promise.then(function () { return moveVerified(item.channel, room); });
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
                return reconcileSquadCapacity(room, 1).then(function () {
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
        var spacers = siblingsOf(parent).filter(function (channel) { return channel.name() === spacerName || channel.name() === spacerBelowName; });
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
                state.divisionIds = [];
                state.squadIds = [];
                state.emptySince = {};
                saveState();
                log('Fleet System channels removed and state reset.', 3);
            });
        });
    }

    function reconcile() {
        if (!state.active || !parentId) return Promise.resolve();
        var room = commandRoom();
        if (!room) return Promise.resolve();
        state.commandRoomId = idOf(room);
        state.squadIds = channelsUnder(room).filter(function (channel) { return isSquadName(channel.name()); }).map(idOf);
        if (state.divisionModeActive) {
            state.divisionIds = discoverFleet(liveChannel(parentId), room).divisions.map(idOf);
        }
        if (!operationRunning) {
            return runExclusive('reconciliation', function () {
                return reconcileAllSquadCapacity(room);
            }).catch(function (error) {
                log('Reconciliation failed: ' + error.message, 2);
            });
        }
        // If an operation is running, defer the capacity reconciliation to its completion
        // by setting up a pending action that will be executed by the current operation.
        if (!pendingAction) {
            pendingAction = { label: 'reconciliation', action: function () { return reconcileAllSquadCapacity(room); } };
            pendingResolve = function () {};
        }
        return new Promise(function (resolve) { pendingResolve = resolve; });
    }

    function cleanupEmptySquads() {
        if (operationRunning || !state.active) return;
        var room = commandRoom();
        if (!room) return;
        runExclusive('capacity reconciliation', function () {
            return reconcileAllSquadCapacity(room);
        }).catch(function (error) {
            log('Capacity reconciliation failed: ' + error.message, 2);
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
            // no polling, no rejection: the command simply runs next.
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
        reply(client, prefix + ' on | off | division on | division off | + | - | help');
    }

    event.on('chat', function (ev) {
        var text = String(ev.text || '').trim();
        if (text !== prefix && text.indexOf(prefix + ' ') !== 0 && text !== prefix + '+' && text !== prefix + '-') return;
        var client = ev.invoker || ev.client;
        if (!authorized(client)) { reply(client, 'You are not authorized to use Fleet Manager.'); return; }
        var command = text.slice(prefix.length).trim().toLowerCase();
        var action;
        if (command === 'on') action = function () { return runExclusive('on', onCommandRoom); };
        else if (command === 'off') action = function () { return runExclusive('off', turnOffAndDelete); };
        else if (command === 'division on') action = function () { return runExclusive('division on', divisionOn); };
        else if (command === 'division off') action = function () { return runExclusive('division off', divisionOff); };
        else if (text === prefix + '+') action = function () { return runExclusive('division +', divisionPlus); };
        else if (text === prefix + '-') action = function () { return runExclusive('division -', divisionMinus); };
        else if (command === 'help') { help(client); return; }
        else { reply(client, 'Unknown command. Use ' + prefix + ' help'); return; }
        action().then(function () { reply(client, 'Fleet Manager: done.'); }).catch(function (error) { reply(client, 'Fleet Manager: ' + error.message); });
    });

    event.on('connect', function () {
        setTimeout(function () { reconcile().catch(function (error) { log('Reconciliation failed: ' + error.message, 2); }); }, 1000);
    });

    cleanupTimer = setInterval(cleanupEmptySquads, reconciliationInterval * 1000);
    log('Loaded; using OKlib ' + (lib.general.checkVersion('1.0.6') ? 'compatible' : 'incompatible') + ' helpers. Reconciliation: every ' + reconciliationInterval + 's; squad deletion: ' + squadDeleteDelay + 's; division deletion: ' + divisionDeleteDelay + 's.', 3);
});

// Pure helper exports are intentionally not used by SinusBot; this comment documents the
// collision-safe invariant: all merged squads are assigned unique [D1] labels before moving.
