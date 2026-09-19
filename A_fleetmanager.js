// Fleet Manager Plugin v1.0.0 for SinusBot
// Dynamic squad and division management system
// Commands: !fs on/off, !fleetsystem on/off, !fs+, !fs help

registerPlugin({
    name: 'Fleet Manager',
    version: '1.0.0',
    description: 'Dynamic squad and division management system with automatic channel creation/deletion',
    author: 'FuelClock',
    backends: ['ts3'],
    vars: [
        { name: 'BOT_NAME', title: 'Bot Command Name', type: 'string', default: 'fs' },
        { name: 'ADMIN_GROUP', title: 'Admin Server Group ID (can manage fleet system)', type: 'string', default: '17' },
        { name: 'PARENT_CHANNEL_ID', title: 'Channel ID of existing parent channel', type: 'channel' },
        { name: 'COMMAND_ROOM_NAME', title: 'Command Room Channel Name', type: 'string', default: 'Command Room' },
        { name: 'SPACER_NAME', title: 'Spacer Channel Name (above)', type: 'string', default: '── Fleet System ──' },
        { name: 'SPACER_BELOW_NAME', title: 'Spacer Channel Name (below)', type: 'string', default: '━━ Fleet System ━━' },
        { name: 'DIVISION_NAMING_MODE', title: 'Division Naming Mode', type: 'select', options: ['number', 'pool'] },
        { name: 'DIVISION_NAME_POOL', title: 'Division Name Pool (comma-separated)', type: 'string', default: 'Alpha,Bravo,Charlie,Delta' },
        { name: 'MAX_SQUADS', title: 'Max Squads Per Division', type: 'number', default: 4 },
        { name: 'SQUAD_DELETE_DELAY', title: 'Empty Squad Delete Delay (seconds)', type: 'number', default: 30 },
        { name: 'DIVISION_DELETE_DELAY', title: 'Division Delete Delay (seconds)', type: 'number', default: 60 },
        {
            name: 'SQUAD_PERMISSIONS',
            title: 'Squad Channel Permissions',
            type: 'array',
            vars: [
                { name: 'permission', title: 'Channel Permission', indent: 3, type: 'select', options: ['Custom', 'i_channel_needed_join_power', 'i_channel_needed_subscribe_power', 'i_channel_needed_description_view_power', 'i_channel_needed_modify_power', 'i_channel_needed_delete_power'] },
                { name: 'customPermission', title: 'Name of the custom Permission', indent: 3, type: 'string', conditions: [{ field: 'permission', value: 0 }] },
                { name: 'value', title: 'Value of the chosen Permission', indent: 3, type: 'number' }
            ]
        },
        {
            name: 'DIVISION_PERMISSIONS',
            title: 'Division Channel Permissions',
            type: 'array',
            vars: [
                { name: 'permission', title: 'Channel Permission', indent: 3, type: 'select', options: ['Custom', 'i_channel_needed_join_power', 'i_channel_needed_subscribe_power', 'i_channel_needed_description_view_power', 'i_channel_needed_modify_power', 'i_channel_needed_delete_power'] },
                { name: 'customPermission', title: 'Name of the custom Permission', indent: 3, type: 'string', conditions: [{ field: 'permission', value: 0 }] },
                { name: 'value', title: 'Value of the chosen Permission', indent: 3, type: 'number' }
            ]
        },
        {
            name: 'COMMAND_ROOM_PERMISSIONS',
            title: 'Command Room Permissions',
            type: 'array',
            vars: [
                { name: 'permission', title: 'Channel Permission', indent: 3, type: 'select', options: ['Custom', 'i_channel_needed_join_power', 'i_channel_needed_subscribe_power', 'i_channel_needed_description_view_power', 'i_channel_needed_modify_power', 'i_channel_needed_delete_power'] },
                { name: 'customPermission', title: 'Name of the custom Permission', indent: 3, type: 'string', conditions: [{ field: 'permission', value: 0 }] },
                { name: 'value', title: 'Value of the chosen Permission', indent: 3, type: 'number' }
            ]
        }
    ],
    requiredModules: ['engine', 'backend', 'event', 'store'],
    autorun: false
}, function(_, config, meta) {
    const engine = require('engine');
    const backend = require('backend');
    const event = require('event');
    const store = require('store');

    var botName = String(config.BOT_NAME || 'fs');
    var adminGroupId = String(config.ADMIN_GROUP || '17');
    var parentChannelId = String(config.PARENT_CHANNEL_ID || '');
    var commandRoomName = String(config.COMMAND_ROOM_NAME || 'Command Room');
    var spacerName = String(config.SPACER_NAME || '── Fleet System ──');
    var spacerBelowName = String(config.SPACER_BELOW_NAME || '━━ Fleet System ━━');
    var divisionNamingMode = String(config.DIVISION_NAMING_MODE || 'number').toLowerCase();
    var divisionNamePool = String(config.DIVISION_NAME_POOL || 'Alpha,Bravo,Charlie,Delta');
    var maxSquads = Math.min(parseInt(config.MAX_SQUADS) || 4, 4);
    var squadDeleteDelay = Math.min(parseInt(config.SQUAD_DELETE_DELAY) || 30, 30);
    var divisionDeleteDelay = parseInt(config.DIVISION_DELETE_DELAY) || 60;
    var squadPermissions = config.SQUAD_PERMISSIONS || [];
    var divisionPermissions = config.DIVISION_PERMISSIONS || [];
    var commandRoomPermissions = config.COMMAND_ROOM_PERMISSIONS || [];

    var SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

    var state = {
        squadSystemActive: false,
        divisionModeActive: false,
        parentChannelId: '',
        commandRoomId: '',
        spacerAboveId: '',
        spacerBelowId: '',
        divisions: [],
        createdChannelIds: [],
        deletionTimers: {},
        divisionTimers: {},
        reconcileTimer: null
    };

    // ===== LOGGING =====
    function logMessage(message, level) {
        engine.log(message);
    }

    // ===== STRING HELPERS =====
    function containsIgnoreCase(value, search) {
        return String(value || '').toLowerCase().indexOf(String(search || '').toLowerCase()) !== -1;
    }

    function equalsIgnoreCase(left, right) {
        return containsIgnoreCase(left, right) && containsIgnoreCase(right, left);
    }

    function isMemberOfOne(client, groups) {
        if (!client || typeof client.getServerGroups !== 'function') {
            return false;
        }
        var groupIds = Array.isArray(groups) ? groups : [groups];
        var clientGroups = client.getServerGroups();
        for (var i = 0; i < clientGroups.length; i++) {
            var clientId = String(clientGroups[i].id());
            for (var j = 0; j < groupIds.length; j++) {
                if (clientId === String(groupIds[j])) {
                    return true;
                }
            }
        }
        return false;
    }

    function isAdmin(invoker) {
        return isMemberOfOne(invoker, [adminGroupId]);
    }

    function getReplyFn(ev) {
        if (ev.mode === 2 && ev.channel && typeof ev.channel === 'function') {
            var channel = ev.channel();
            if (channel && typeof channel.chat === 'function') {
                return function(msg) { channel.chat(msg); };
            }
        }
        if (ev.mode === 1 && ev.client && typeof ev.client.chat === 'function') {
            return function(msg) { ev.client.chat(msg); };
        }
        if (ev.mode === 3) {
            return function(msg) { backend.chat(msg); };
        }
        return function(msg) {
            if (ev.client && typeof ev.client.chat === 'function') {
                ev.client.chat(msg);
            } else {
                backend.chat(msg);
            }
        };
    }

    function parseNames(value) {
        var result = [];
        var parts = String(value || '').split(',');
        for (var i = 0; i < parts.length; i++) {
            var name = String(parts[i] || '').trim();
            if (name) {
                result.push(name);
            }
        }
        return result;
    }

    // ===== PERMISSIONS =====
    function parsePermissions(value) {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value;
        }
        try {
            var parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            if (typeof parsed === 'object' && parsed !== null) {
                var result = [];
                for (var key in parsed) {
                    if (parsed.hasOwnProperty(key)) {
                        result.push({
                            permission: key,
                            value: parsed[key]
                        });
                    }
                }
                return result;
            }
        } catch (e) {
            logMessage('WARNING: Could not parse permissions JSON: ' + e.message, 2);
        }
        return [];
    }

    function applyPermissions(channel, permissionConfig) {
        if (!channel || typeof channel.addPermission !== 'function') {
            return;
        }
        var permissions = parsePermissions(permissionConfig);
        if (!permissions || permissions.length === 0) {
            return;
        }
        setTimeout(function() {
            for (var i = 0; i < permissions.length; i++) {
                var currentPermission = permissions[i];
                var defaultPermissions = [
                    currentPermission.customPermission,
                    'i_channel_needed_join_power',
                    'i_channel_needed_subscribe_power',
                    'i_channel_needed_description_view_power',
                    'i_channel_needed_modify_power',
                    'i_channel_needed_delete_power'
                ];
                var permissionName = defaultPermissions[parseInt(currentPermission.permission || '0')];
                if (!permissionName) {
                    continue;
                }
                try {
                    var permission = channel.addPermission(permissionName);
                    permission.setValue(currentPermission.value);
                    permission.save();
                    logMessage('Fleet Manager: Applied permission ' + permissionName + ' = ' + currentPermission.value + ' to ' + channel.name(), 4);
                } catch (e) {
                    logMessage('Fleet Manager: Failed to apply permission ' + permissionName + ' to ' + channel.name() + ': ' + e.message, 2);
                }
            }
        }, 500);
    }

    // ===== CHANNEL HELPERS =====
    function getChannelById(id) {
        if (!id) return null;
        return backend.getChannelByID(String(id));
    }

    function getChildren(channel) {
        if (!channel) return [];
        var parentId = String(channel.id());
        var allChannels = backend.getChannels();
        var children = [];
        for (var i = 0; i < allChannels.length; i++) {
            var ch = allChannels[i];
            if (ch.parent && ch.parent()) {
                try {
                    if (String(ch.parent().id()) === parentId) {
                        children.push(ch);
                    }
                } catch (e) {}
            }
        }
        return children;
    }

    function findChannelByName(channels, name) {
        for (var i = 0; i < channels.length; i++) {
            if (channels[i].name() === name) {
                return channels[i];
            }
        }
        return null;
    }

    function createChannel(name, parentId, extraParams) {
        var params = {
            name: name,
            parent: parentId,
            permanent: true
        };
        if (extraParams) {
            for (var key in extraParams) {
                if (extraParams.hasOwnProperty(key)) {
                    params[key] = extraParams[key];
                }
            }
        }
        if (params.permanent || params.semiPermanent) {
            delete params.deleteDelay;
        }
        try {
            var channel = backend.createChannel(params);
            if (channel) {
                state.createdChannelIds.push(String(channel.id()));
                logMessage('Fleet Manager: Created channel "' + name + '" (id=' + channel.id() + ') under parent ' + parentId, 4);
            }
            return channel;
        } catch (e) {
            logMessage('Fleet Manager: Failed to create channel "' + name + '": ' + e.message, 1);
            return null;
        }
    }

    function deleteChannel(channelId) {
        var id = String(channelId);
        var channel = getChannelById(id);
        if (!channel) {
            state.createdChannelIds = state.createdChannelIds.filter(function(x) { return String(x) !== id; });
            return false;
        }
        if (state.createdChannelIds.indexOf(id) === -1) {
            logMessage('Fleet Manager: Refusing to delete channel not created by plugin: ' + id, 2);
            return false;
        }
        try {
            channel.delete();
            state.createdChannelIds = state.createdChannelIds.filter(function(x) { return String(x) !== id; });
            logMessage('Fleet Manager: Deleted channel "' + channel.name() + '" (id=' + id + ')', 4);
            return true;
        } catch (e) {
            logMessage('Fleet Manager: Failed to delete channel "' + channel.name() + '" (id=' + id + '): ' + e.message, 2);
            return false;
        }
    }

    function renameChannel(channel, newName) {
        if (!channel || typeof channel.rename !== 'function') return false;
        try {
            channel.rename(newName);
            logMessage('Fleet Manager: Renamed channel to "' + newName + '" (id=' + channel.id() + ')', 4);
            return true;
        } catch (e) {
            logMessage('Fleet Manager: Failed to rename channel: ' + e.message, 2);
            return false;
        }
    }

    function moveChannel(channelId, newParentId) {
        var id = String(channelId);
        var channel = getChannelById(id);
        if (!channel || typeof channel.moveTo !== 'function') return false;
        try {
            channel.moveTo(newParentId, 0);
            logMessage('Fleet Manager: Moved channel "' + channel.name() + '" (id=' + id + ') to parent ' + newParentId, 4);
            return true;
        } catch (e) {
            logMessage('Fleet Manager: Failed to move channel "' + channel.name() + '" (id=' + id + '): ' + e.message, 2);
            return false;
        }
    }

    function getChannelClients(channelId) {
        var channel = getChannelById(channelId);
        if (!channel || typeof channel.getClients !== 'function') return [];
        try {
            return channel.getClients() || [];
        } catch (e) {
            return [];
        }
    }

    // ===== BOT CHANNEL GUARD =====
    function withBotChannelGuard(operation) {
        var bot = backend.getBotClient();
        var recordedChannelId = '';
        if (bot && typeof bot.channel === 'function') {
            var ch = bot.channel();
            if (ch) recordedChannelId = String(ch.id());
        }
        try {
            return operation();
        } finally {
            if (recordedChannelId && backend.isConnected()) {
                var bot2 = backend.getBotClient();
                if (bot2 && typeof bot2.moveTo === 'function') {
                    var currentCh = bot2.channel();
                    if (!currentCh || String(currentCh.id()) !== recordedChannelId) {
                        try {
                            bot2.moveTo(recordedChannelId);
                        } catch (e) {
                            logMessage('Fleet Manager: Failed to restore bot channel: ' + e.message, 2);
                        }
                    }
                }
            }
        }
    }

    // ===== NAMING HELPERS =====
    function getSquadName(divisionNumber, index) {
        var squadName = index >= 0 && index < SQUAD_NAMES.length ? SQUAD_NAMES[index] : 'Squad ' + (index + 1);
        return '[D' + divisionNumber + '] Squad ' + squadName;
    }

    function isSquadChannel(channel) {
        if (!channel) return false;
        return /^\[D\d+\] Squad (Alpha|Bravo|Charlie|Delta)$/.test(channel.name());
    }

    function isDivisionChannel(channel) {
        if (!channel) return false;
        var name = channel.name();
        if (/^Division \d+$/.test(name)) return true;
        var poolNames = parseNames(divisionNamePool);
        if (poolNames.indexOf(name) !== -1) return true;
        return false;
    }

    function parseSquadName(name) {
        var match = String(name || '').match(/^\[D(\d+)\] Squad (Alpha|Bravo|Charlie|Delta)$/);
        if (!match) return null;
        var index = SQUAD_NAMES.indexOf(match[2]);
        if (index === -1) return null;
        return { divisionNumber: parseInt(match[1]), index: index };
    }

    function getDivisionNumberFromName(name) {
        var match = String(name || '').match(/^Division (\d+)$/);
        if (match) return parseInt(match[1]);
        var poolNames = parseNames(divisionNamePool);
        var idx = poolNames.indexOf(name);
        return idx >= 0 ? idx + 1 : 0;
    }

    function getDivisionDisplayName(divisionNumber) {
        if (divisionNamingMode === 'pool') {
            var poolNames = parseNames(divisionNamePool);
            if (poolNames.length > 0) {
                var idx = (divisionNumber - 1) % poolNames.length;
                return poolNames[idx];
            }
        }
        return 'Division ' + divisionNumber;
    }

    // ===== STATE PERSISTENCE =====
    function saveState() {
        try {
            store.set('fleetManagerState', JSON.stringify({
                squadSystemActive: state.squadSystemActive,
                divisionModeActive: state.divisionModeActive,
                parentChannelId: state.parentChannelId,
                commandRoomId: state.commandRoomId,
                spacerAboveId: state.spacerAboveId,
                spacerBelowId: state.spacerBelowId,
                divisions: state.divisions,
                createdChannelIds: state.createdChannelIds
            }));
        } catch (e) {
            logMessage('Fleet Manager: Failed to save state: ' + e.message, 2);
        }
    }

    function loadState() {
        try {
            var stored = store.get('fleetManagerState');
            if (stored) {
                var parsed = JSON.parse(stored);
                if (parsed && typeof parsed === 'object') {
                    state.squadSystemActive = !!parsed.squadSystemActive;
                    state.divisionModeActive = !!parsed.divisionModeActive;
                    state.parentChannelId = String(parsed.parentChannelId || '');
                    state.commandRoomId = String(parsed.commandRoomId || '');
                    state.spacerAboveId = String(parsed.spacerAboveId || '');
                    state.spacerBelowId = String(parsed.spacerBelowId || '');
                    state.divisions = Array.isArray(parsed.divisions) ? parsed.divisions : [];
                    state.createdChannelIds = Array.isArray(parsed.createdChannelIds) ? parsed.createdChannelIds : [];
                    return true;
                }
            }
        } catch (e) {
            logMessage('Fleet Manager: Failed to load state: ' + e.message, 2);
        }
        return false;
    }

    // ===== CHANNEL DISCOVERY =====
    function discoverManagedChannels() {
        if (!parentChannelId) return false;
        var parent = getChannelById(parentChannelId);
        if (!parent) return false;

        var allChannels = backend.getChannels();
        var parentIdStr = String(parentChannelId);

        // Find children of parent
        var parentChildren = [];
        for (var i = 0; i < allChannels.length; i++) {
            var ch = allChannels[i];
            if (ch.parent && ch.parent()) {
                try {
                    if (String(ch.parent().id()) === parentIdStr) {
                        parentChildren.push(ch);
                    }
                } catch (e) {}
            }
        }

        // Find Command Room
        var commandRoom = findChannelByName(parentChildren, commandRoomName);
        if (!commandRoom) return false;
        var commandRoomIdStr = String(commandRoom.id());

        // Find children of command room
        var commandRoomChildren = [];
        for (var i = 0; i < allChannels.length; i++) {
            var ch = allChannels[i];
            if (ch.parent && ch.parent()) {
                try {
                    if (String(ch.parent().id()) === commandRoomIdStr) {
                        commandRoomChildren.push(ch);
                    }
                } catch (e) {}
            }
        }

        // Find spacer channels
        for (var i = 0; i < parentChildren.length; i++) {
            var pch = parentChildren[i];
            if (pch.name() === spacerName) state.spacerAboveId = String(pch.id());
            else if (pch.name() === spacerBelowName) state.spacerBelowId = String(pch.id());
        }

        // Separate division channels and squad channels
        var divisionChannels = [];
        var squadChannelsDirect = [];
        for (var i = 0; i < commandRoomChildren.length; i++) {
            var ch = commandRoomChildren[i];
            if (isSquadChannel(ch)) squadChannelsDirect.push(ch);
            else if (isDivisionChannel(ch)) divisionChannels.push(ch);
        }

        state.commandRoomId = commandRoomIdStr;
        state.parentChannelId = parentIdStr;
        state.divisions = [];

        if (divisionChannels.length > 0) {
            // Division mode
            state.divisionModeActive = true;
            divisionChannels.sort(function(a, b) {
                return getDivisionNumberFromName(a.name()) - getDivisionNumberFromName(b.name());
            });

            for (var i = 0; i < divisionChannels.length; i++) {
                var divCh = divisionChannels[i];
                var divNum = getDivisionNumberFromName(divCh.name());
                if (divNum < 1) divNum = i + 1;

                var division = {
                    id: String(divCh.id()),
                    name: divCh.name(),
                    divisionNumber: divNum,
                    squads: []
                };

                var divIdStr = String(divCh.id());
                for (var j = 0; j < allChannels.length; j++) {
                    var sch = allChannels[j];
                    if (sch.parent && sch.parent()) {
                        try {
                            if (String(sch.parent().id()) === divIdStr && isSquadChannel(sch)) {
                                var info = parseSquadName(sch.name());
                                if (info) {
                                    division.squads.push({ index: info.index, name: sch.name(), id: String(sch.id()) });
                                }
                            }
                        } catch (e) {}
                    }
                }
                division.squads.sort(function(a, b) { return a.index - b.index; });
                state.divisions.push(division);
            }
        } else {
            // Non-division mode
            state.divisionModeActive = false;
            var division = {
                id: commandRoomIdStr,
                name: commandRoomName,
                divisionNumber: 1,
                squads: []
            };
            for (var i = 0; i < squadChannelsDirect.length; i++) {
                var sch = squadChannelsDirect[i];
                var info = parseSquadName(sch.name());
                if (info && info.divisionNumber === 1) {
                    division.squads.push({ index: info.index, name: sch.name(), id: String(sch.id()) });
                }
            }
            division.squads.sort(function(a, b) { return a.index - b.index; });
            state.divisions = [division];
        }

        // Rebuild createdChannelIds from discovered channels
        var allManagedIds = [];
        if (state.spacerAboveId) allManagedIds.push(state.spacerAboveId);
        if (state.spacerBelowId) allManagedIds.push(state.spacerBelowId);
        allManagedIds.push(state.commandRoomId);
        for (var i = 0; i < state.divisions.length; i++) {
            if (state.divisionModeActive) allManagedIds.push(state.divisions[i].id);
            for (var j = 0; j < state.divisions[i].squads.length; j++) {
                allManagedIds.push(state.divisions[i].squads[j].id);
            }
        }
        state.createdChannelIds = allManagedIds;

        return true;
    }

    // ===== SQUAD MANAGEMENT =====
    function findDivision(divisionId) {
        for (var i = 0; i < state.divisions.length; i++) {
            if (String(state.divisions[i].id) === String(divisionId)) return state.divisions[i];
        }
        return null;
    }

    function getSquadByIndex(division, index) {
        for (var i = 0; i < division.squads.length; i++) {
            if (division.squads[i].index === index) return division.squads[i];
        }
        return null;
    }

    function createSquad(division, index) {
        if (index < 0 || index >= maxSquads) return null;
        var existing = getSquadByIndex(division, index);
        if (existing) return existing;

        var squadName = getSquadName(division.divisionNumber, index);
        var parentId = state.divisionModeActive ? division.id : state.commandRoomId;
        var channel = createChannel(squadName, parentId, { description: '', topic: '', permanent: true });
        if (!channel) return null;

        applyPermissions(channel, squadPermissions);
        var squad = { index: index, name: squadName, id: String(channel.id()) };
        division.squads.push(squad);
        return squad;
    }

    function deleteSquad(division, index) {
        var squad = getSquadByIndex(division, index);
        if (!squad) return;
        deleteChannel(squad.id);
        for (var i = 0; i < division.squads.length; i++) {
            if (division.squads[i].index === index) {
                division.squads.splice(i, 1);
                break;
            }
        }
    }

    function cancelDeletionTimer(divisionId) {
        if (state.deletionTimers[divisionId]) {
            clearTimeout(state.deletionTimers[divisionId]);
            delete state.deletionTimers[divisionId];
        }
    }

    function reconcileDivision(division) {
        if (!state.squadSystemActive) return;

        // Count occupied and empty squads
        var occupied = 0;
        var empty = 0;
        var emptyIndices = [];
        for (var i = 0; i < division.squads.length; i++) {
            var squad = division.squads[i];
            var members = getChannelClients(squad.id);
            if (members.length > 0) {
                occupied++;
            } else {
                empty++;
                emptyIndices.push(squad.index);
            }
        }
        emptyIndices.sort(function(a, b) { return b - a; });

        // If more than 1 empty squad, schedule deletion of excess after delay
        if (empty > 1) {
            if (!state.deletionTimers[division.id]) {
                var excessCount = empty - 1;
                var excessIndices = emptyIndices.slice(0, excessCount);
                var divisionId = division.id;
                state.deletionTimers[divisionId] = setTimeout(function() {
                    var currentDivision = findDivision(divisionId);
                    if (!currentDivision) {
                        delete state.deletionTimers[divisionId];
                        return;
                    }
                    for (var j = 0; j < excessIndices.length; j++) {
                        var idx = excessIndices[j];
                        var s = getSquadByIndex(currentDivision, idx);
                        if (s) {
                            var members2 = getChannelClients(s.id);
                            if (members2.length === 0) {
                                deleteSquad(currentDivision, idx);
                            }
                        }
                    }
                    delete state.deletionTimers[divisionId];
                }, squadDeleteDelay * 1000);
            }
        } else {
            cancelDeletionTimer(division.id);
        }

        // Calculate desired number of squads
        var desired = Math.min(occupied + 1, maxSquads);
        if (occupied === 0) desired = 1;

        var total = division.squads.length;

        // Find missing indices
        var missingIndices = [];
        for (var i = 0; i < maxSquads; i++) {
            var found = false;
            for (var j = 0; j < division.squads.length; j++) {
                if (division.squads[j].index === i) { found = true; break; }
            }
            if (!found) missingIndices.push(i);
        }

        // Create squads until we reach desired total
        while (total < desired && missingIndices.length > 0) {
            var nextIndex = missingIndices.shift();
            var created = createSquad(division, nextIndex);
            if (created) {
                total++;
            } else {
                break;
            }
        }
    }

    // ===== DIVISION MANAGEMENT =====
    function getDivisionName() {
        if (divisionNamingMode === 'pool') {
            var names = parseNames(divisionNamePool);
            var usedNames = [];
            for (var i = 0; i < state.divisions.length; i++) usedNames.push(state.divisions[i].name);
            for (var j = 0; j < names.length; j++) {
                if (usedNames.indexOf(names[j]) === -1) return names[j];
            }
            return 'Division ' + (state.divisions.length + 1);
        }
        var maxNum = 0;
        for (var i = 0; i < state.divisions.length; i++) {
            var match = state.divisions[i].name.match(/(\d+)$/);
            if (match) {
                var num = parseInt(match[1]);
                if (num > maxNum) maxNum = num;
            }
        }
        return 'Division ' + (maxNum + 1);
    }

    function createDivision(name, divisionNumber) {
        var division = { id: '', name: name, divisionNumber: divisionNumber, squads: [] };
        var channel = createChannel(name, state.commandRoomId, { description: '', topic: '', permanent: true });
        if (!channel) return null;
        applyPermissions(channel, divisionPermissions);
        division.id = String(channel.id());
        state.divisions.push(division);
        return division;
    }

    function deleteDivision(divisionId) {
        var division = findDivision(divisionId);
        if (!division) return;
        for (var i = 0; i < division.squads.length; i++) {
            deleteChannel(division.squads[i].id);
        }
        deleteChannel(division.id);
        state.divisions = state.divisions.filter(function(d) { return String(d.id) !== String(divisionId); });
        cancelDeletionTimer(divisionId);
        if (state.divisionTimers[divisionId]) {
            clearTimeout(state.divisionTimers[divisionId]);
            delete state.divisionTimers[divisionId];
        }
    }

    // ===== SQUAD NAMING HELPERS =====
    // Rewrites every squad channel under `parentChannel` so that all names
    // carry the correct `[D<div>]` prefix for `divisionNumber`.  If two
    // squads would receive the identical name, the second one is assigned
    // the next free squad slot (Alpha→Bravo→Charlie→Delta→Squad 5…).
    function syncSquadNamesUnder(parentChannel, divisionNumber) {
        if (!parentChannel || !parentChannel.id) return;
        var children = getChildren(parentChannel);
        var squads = [];
        for (var i = 0; i < children.length; i++) {
            if (isSquadChannel(children[i])) {
                squads.push(children[i]);
            }
        }
        squads.sort(function(a, b) {
            var aName = a.name() || '';
            var bName = b.name() || '';
            if (aName < bName) return -1;
            if (aName > bName) return 1;
            return 0;
        });
        var assignedIndices = {};
        var usedNames = {};
        for (var i = 0; i < squads.length; i++) {
            var ch = squads[i];
            var info = parseSquadName(ch.name());
            var targetIdx;
            // Keep the squad's original slot if nobody else claimed it yet.
            // The first loop only recorded existing slots; it must not block
            // the squad that owns that slot from keeping it.
            if (info && info.index >= 0 && !assignedIndices[info.index]) {
                targetIdx = info.index;
            } else {
                var nextIndex = 0;
                while (assignedIndices[nextIndex]) { nextIndex++; }
                targetIdx = nextIndex;
            }
            assignedIndices[targetIdx] = true;
            var targetName = getSquadName(divisionNumber, targetIdx);
            if (usedNames[targetName]) {
                var suffix = 2;
                while (usedNames[targetName + ' ' + suffix]) { suffix++; }
                targetName = targetName + ' ' + suffix;
            }
            usedNames[targetName] = true;
            if (ch.name() !== targetName) {
                renameChannel(ch, targetName);
            }
        }
    }

    // ===== HIERARCHY VERIFICATION =====
    function verifyAndRecreateSpacer(name, stateKey) {
        var spacerId = state[stateKey];
        if (spacerId) {
            var spacer = getChannelById(spacerId);
            if (!spacer) {
                var newSpacer = createChannel(name, state.parentChannelId, { permanent: true });
                if (newSpacer) {
                    state[stateKey] = String(newSpacer.id());
                }
            }
        }
    }

    function verifyAndFixHierarchy() {
        if (!state.squadSystemActive) return;
        if (!backend.isConnected()) return;

        withBotChannelGuard(function() {
            var parent = getChannelById(state.parentChannelId);
            if (!parent) return;

            // Verify spacers
            verifyAndRecreateSpacer(spacerName, 'spacerAboveId');
            verifyAndRecreateSpacer(spacerBelowName, 'spacerBelowId');

            // Verify Command Room
            var commandRoom = getChannelById(state.commandRoomId);
            if (!commandRoom) {
                var parentChildren = getChildren(parent);
                commandRoom = findChannelByName(parentChildren, commandRoomName);
                if (commandRoom) {
                    state.commandRoomId = String(commandRoom.id());
                } else {
                    var newCR = createChannel(commandRoomName, state.parentChannelId, { permanent: true });
                    if (newCR) {
                        state.commandRoomId = String(newCR.id());
                        commandRoom = newCR;
                        applyPermissions(commandRoom, commandRoomPermissions);
                    }
                }
            }
            if (!commandRoom) return;

            // Verify based on mode
            if (state.divisionModeActive) {
                verifyDivisionModeHierarchy(commandRoom);
            } else {
                verifyNonDivisionModeHierarchy(commandRoom);
            }

            saveState();
        });
    }

    function verifyNonDivisionModeHierarchy(commandRoom) {
        var children = getChildren(commandRoom);
        var squadChannels = [];
        var strayDivisions = [];

        for (var i = 0; i < children.length; i++) {
            var ch = children[i];
            if (isSquadChannel(ch)) {
                squadChannels.push(ch);
            } else if (isDivisionChannel(ch)) {
                strayDivisions.push(ch);
            }
        }

        // Handle stray divisions (delete them, move their squads to command room)
        for (var i = 0; i < strayDivisions.length; i++) {
            handleStrayDivision(strayDivisions[i], state.commandRoomId);
        }

        // Sync all squads under Command Room to [D1] prefix with collision handling
        syncSquadNamesUnder(commandRoom, 1);

        // Get or create implicit division (Division 1)
        var division = findDivision(state.commandRoomId);
        if (!division) {
            division = { id: state.commandRoomId, name: commandRoomName, divisionNumber: 1, squads: [] };
            state.divisions.push(division);
        } else {
            division.id = state.commandRoomId;
            division.name = commandRoomName;
            division.divisionNumber = 1;
        }

        // Update squad list from discovered channels
        division.squads = [];
        for (var i = 0; i < squadChannels.length; i++) {
            var ch = squadChannels[i];
            var info = parseSquadName(ch.name());
            if (info && info.divisionNumber === 1) {
                division.squads.push({ index: info.index, name: ch.name(), id: String(ch.id()) });
            } else if (info) {
                // Wrong prefix — rename to [D1]
                var correctName = getSquadName(1, info.index);
                renameChannel(ch, correctName);
                division.squads.push({ index: info.index, name: correctName, id: String(ch.id()) });
            }
        }

        reconcileDivision(division);
    }

    function verifyDivisionModeHierarchy(commandRoom) {
        var children = getChildren(commandRoom);
        var divisionChannels = [];
        var straySquads = [];

        for (var i = 0; i < children.length; i++) {
            var ch = children[i];
            if (isDivisionChannel(ch)) {
                divisionChannels.push(ch);
            } else if (isSquadChannel(ch)) {
                straySquads.push(ch);
            }
        }

        // Sort divisions by number
        divisionChannels.sort(function(a, b) {
            return getDivisionNumberFromName(a.name()) - getDivisionNumberFromName(b.name());
        });

        // Build division list from discovered channels
        var divisions = [];
        for (var i = 0; i < divisionChannels.length; i++) {
            var divCh = divisionChannels[i];
            var divNum = getDivisionNumberFromName(divCh.name());
            if (divNum < 1) divNum = i + 1;

            var division = {
                id: String(divCh.id()),
                name: divCh.name(),
                divisionNumber: divNum,
                squads: []
            };

            var divChildren = getChildren(divCh);
            for (var j = 0; j < divChildren.length; j++) {
                var sch = divChildren[j];
                if (isSquadChannel(sch)) {
                    var info = parseSquadName(sch.name());
                    if (info && info.divisionNumber === divNum) {
                        division.squads.push({ index: info.index, name: sch.name(), id: String(sch.id()) });
                    } else if (info) {
                        // Wrong prefix — rename to match parent division
                        var correctName = getSquadName(divNum, info.index);
                        renameChannel(sch, correctName);
                        division.squads.push({ index: info.index, name: correctName, id: String(sch.id()) });
                    }
                }
            }
            division.squads.sort(function(a, b) { return a.index - b.index; });
            divisions.push(division);
        }

        // Ensure Division 1 and Division 2 exist
        while (divisions.length < 2) {
            var nextNum = divisions.length + 1;
            var divName = getDivisionDisplayName(nextNum);
            var newDiv = createDivision(divName, nextNum);
            if (newDiv) {
                divisions.push(newDiv);
            } else {
                break;
            }
        }

        // Move stray squads to Division 1
        for (var i = 0; i < straySquads.length; i++) {
            var ch = straySquads[i];
            if (divisions.length > 0) {
                moveChannel(ch.id(), divisions[0].id);
                var info = parseSquadName(ch.name());
                var idx = info ? info.index : -1;
                if (idx >= 0) {
                    // Rename to correct [D1] prefix to match destination division
                    var correctName = getSquadName(1, idx);
                    renameChannel(ch, correctName);
                    divisions[0].squads.push({ index: idx, name: correctName, id: String(ch.id()) });
                } else {
                    deleteChannel(ch.id());
                }
            } else {
                deleteChannel(ch.id());
            }
        }

        // Ensure all Division 1 squads have correct [D1] prefix and no duplicates
        syncSquadNamesUnder(divisions[0], 1);

        state.divisions = divisions;

        // Reconcile each division
        for (var i = 0; i < state.divisions.length; i++) {
            reconcileDivision(state.divisions[i]);
        }
    }

    function handleStrayDivision(divisionChannel, targetParentId) {
        var divChildren = getChildren(divisionChannel);
        for (var i = 0; i < divChildren.length; i++) {
            var ch = divChildren[i];
            if (isSquadChannel(ch)) {
                moveChannel(ch.id(), targetParentId);
                // Rename to [D1] prefix when moving to Command Room (implicit Division 1)
                var info = parseSquadName(ch.name());
                if (info && info.index >= 0) {
                    var correctName = getSquadName(1, info.index);
                    renameChannel(ch, correctName);
                }
            }
        }
        deleteChannel(divisionChannel.id());
    }

    // ===== RECONCILIATION =====
    function reconcileAll() {
        if (!state.squadSystemActive) return;
        if (!backend.isConnected()) return;

        withBotChannelGuard(function() {
            var parent = getChannelById(state.parentChannelId);
            var commandRoom = getChannelById(state.commandRoomId);
            if (!parent || !commandRoom) {
                if (parentChannelId) {
                    discoverManagedChannels();
                }
                return;
            }
            verifyAndFixHierarchy();
        });
    }

    function startReconciliation() {
        if (state.reconcileTimer) clearInterval(state.reconcileTimer);
        state.reconcileTimer = setInterval(reconcileAll, 5000);
    }

    function stopReconciliation() {
        if (state.reconcileTimer) {
            clearInterval(state.reconcileTimer);
            state.reconcileTimer = null;
        }
    }

    // ===== COMMAND HANDLERS =====
    function toggleSquadSystem(turnOn, invoker, reply) {
        if (turnOn) {
            if (state.squadSystemActive) {
                reply('[Fleet Manager] Squad system is already active.');
                return;
            }
            if (!parentChannelId) {
                reply('[Fleet Manager] No parent channel configured. Set PARENT_CHANNEL_ID first.');
                return;
            }

            withBotChannelGuard(function() {
                var parent = getChannelById(parentChannelId);
                if (!parent) {
                    reply('[Fleet Manager] Parent channel not found: ' + parentChannelId);
                    return;
                }

                state.squadSystemActive = true;
                state.parentChannelId = String(parentChannelId);
                state.divisionModeActive = false;
                state.divisions = [];

                var spacerAbove = createChannel(spacerName, parentChannelId, { permanent: true });
                var commandRoom = createChannel(commandRoomName, parentChannelId, { permanent: true });
                var spacerBelow = createChannel(spacerBelowName, parentChannelId, { permanent: true });

                if (!spacerAbove || !commandRoom || !spacerBelow) {
                    state.squadSystemActive = false;
                    reply('[Fleet Manager] Failed to create fleet system channels.');
                    return;
                }

                applyPermissions(commandRoom, commandRoomPermissions);
                state.commandRoomId = String(commandRoom.id());
                state.spacerAboveId = String(spacerAbove.id());
                state.spacerBelowId = String(spacerBelow.id());

                var defaultDivision = { id: state.commandRoomId, name: commandRoomName, divisionNumber: 1, squads: [] };
                state.divisions = [defaultDivision];
                createSquad(defaultDivision, 0);

                saveState();
                startReconciliation();
                reply('[Fleet Manager] Squad system activated. Command Room created.');
                logMessage('Fleet Manager: Fleet system activated. Command Room id=' + state.commandRoomId, 3);
            });
        } else {
            if (!state.squadSystemActive) {
                reply('[Fleet Manager] Squad system is already inactive.');
                return;
            }

            stopReconciliation();

            withBotChannelGuard(function() {
                for (var key in state.deletionTimers) {
                    clearTimeout(state.deletionTimers[key]);
                }
                for (var key2 in state.divisionTimers) {
                    clearTimeout(state.divisionTimers[key2]);
                }
                state.deletionTimers = {};
                state.divisionTimers = {};

                for (var i = 0; i < state.divisions.length; i++) {
                    var division = state.divisions[i];
                    for (var j = 0; j < division.squads.length; j++) {
                        deleteChannel(division.squads[j].id);
                    }
                    if (state.divisionModeActive && String(division.id) !== String(state.commandRoomId)) {
                        deleteChannel(division.id);
                    }
                }
                if (state.spacerAboveId) deleteChannel(state.spacerAboveId);
                if (state.spacerBelowId) deleteChannel(state.spacerBelowId);
                if (state.commandRoomId) deleteChannel(state.commandRoomId);

                state.squadSystemActive = false;
                state.divisionModeActive = false;
                state.commandRoomId = '';
                state.spacerAboveId = '';
                state.spacerBelowId = '';
                state.divisions = [];
                saveState();
                reply('[Fleet Manager] Squad system deactivated. All created channels removed.');
                logMessage('Fleet Manager: Fleet system deactivated.', 3);
            });
        }
    }

    function activateDivisionMode(reply) {
        if (!state.squadSystemActive) {
            reply('[Fleet Manager] Squad system is not active.');
            return;
        }
        if (state.divisionModeActive) {
            reply('[Fleet Manager] Division mode is already active.');
            return;
        }

        withBotChannelGuard(function() {
            var defaultDivision = findDivision(state.commandRoomId);
            if (!defaultDivision) {
                reply('[Fleet Manager] Command Room not found.');
                return;
            }

            var division1Name = getDivisionDisplayName(1);
            var division2Name = getDivisionDisplayName(2);
            var division1 = createDivision(division1Name, 1);
            var division2 = createDivision(division2Name, 2);

            if (!division1 || !division2) {
                reply('[Fleet Manager] Failed to create divisions.');
                return;
            }

            // Move existing squads to Division 1
            for (var i = 0; i < defaultDivision.squads.length; i++) {
                moveChannel(defaultDivision.squads[i].id, division1.id);
            }
            division1.squads = defaultDivision.squads.slice();
            defaultDivision.squads = [];

            // Division 2 starts with one empty squad
            createSquad(division2, 0);

            state.divisionModeActive = true;
            state.divisions = [division1, division2];
            saveState();
            reply('[Fleet Manager] Division mode activated. Existing squads moved to ' + division1Name + '.');
            logMessage('Fleet Manager: Division mode activated.', 3);
        });
    }

    function deactivateDivisionMode(reply) {
        if (!state.squadSystemActive) {
            reply('[Fleet Manager] Squad system is not active.');
            return;
        }
        if (!state.divisionModeActive) {
            reply('[Fleet Manager] Division mode is already inactive.');
            return;
        }

        stopReconciliation();
        state.divisionModeActive = false;
        withBotChannelGuard(function() {
            var commandRoom = getChannelById(state.commandRoomId);
            if (!commandRoom) {
                state.divisionModeActive = true;
                reply('[Fleet Manager] Command Room not found.');
                return;
            }

            // Discover REAL division channels from the channel tree
            var children = getChildren(commandRoom);
            var realDivisions = [];
            for (var i = 0; i < children.length; i++) {
                var ch = children[i];
                if (isDivisionChannel(ch)) {
                    realDivisions.push(ch);
                }
            }

            // Move all squads from real divisions back to Command Room
            for (var i = 0; i < realDivisions.length; i++) {
                var divChildren = getChildren(realDivisions[i]);
                for (var j = 0; j < divChildren.length; j++) {
                    var ch = divChildren[j];
                    if (isSquadChannel(ch)) {
                        moveChannel(ch.id(), state.commandRoomId);
                    }
                }
            }

            // Delete all real division channels (not stored state)
            for (var i = 0; i < realDivisions.length; i++) {
                var divCh = realDivisions[i];
                if (String(divCh.id()) !== String(state.commandRoomId)) {
                    deleteChannel(divCh.id());
                }
            }

            // Sync all squads under Command Room to [D1] prefix with collision handling
            syncSquadNamesUnder(commandRoom, 1);

            // Reset state
            state.divisionModeActive = false;
            state.divisions = [{ id: state.commandRoomId, name: commandRoomName, divisionNumber: 1, squads: [] }];
            saveState();
            startReconciliation();
            reply('[Fleet Manager] Division mode deactivated. Squads moved back to Command Room.');
            logMessage('Fleet Manager: Division mode deactivated.', 3);
        });
    }

    function createNewDivision(reply) {
        if (!state.squadSystemActive) {
            reply('[Fleet Manager] Squad system is not active.');
            return;
        }
        if (!state.divisionModeActive) {
            reply('[Fleet Manager] Division mode is not active. Use !fs+ only in division mode.');
            return;
        }

        withBotChannelGuard(function() {
            var nextNumber = state.divisions.length + 1;
            var divName = getDivisionDisplayName(nextNumber);
            var division = createDivision(divName, nextNumber);
            if (!division) {
                reply('[Fleet Manager] Failed to create new division.');
                return;
            }
            createSquad(division, 0);

            var divisionId = division.id;
            var timer = setTimeout(function() {
                var currentDivision = findDivision(divisionId);
                if (!currentDivision) return;
                var hasMembers = false;
                for (var i = 0; i < currentDivision.squads.length; i++) {
                    if (getChannelClients(currentDivision.squads[i].id).length > 0) {
                        hasMembers = true;
                        break;
                    }
                }
                if (!hasMembers) {
                    deleteDivision(divisionId);
                    logMessage('Fleet Manager: Deleted empty division "' + division.name + '" after ' + divisionDeleteDelay + ' seconds.', 3);
                }
                delete state.divisionTimers[divisionId];
            }, divisionDeleteDelay * 1000);
            state.divisionTimers[division.id] = timer;

            saveState();
            reply('[Fleet Manager] Division "' + division.name + '" created. It will be deleted if empty after ' + divisionDeleteDelay + ' seconds.');
            logMessage('Fleet Manager: Created division "' + division.name + '" (id=' + division.id + ').', 3);
        });
    }

    function handleCommand(args, ev) {
        var invoker = ev.client;
        if (!isAdmin(invoker)) {
            var reply = getReplyFn(ev);
            reply('[Fleet Manager] Permission denied.');
            return;
        }
        var reply = getReplyFn(ev);
        var parts = args.trim().split(/\s+/);
        var subCommand = parts[0].toLowerCase();

        if (subCommand === 'on') {
            toggleSquadSystem(true, invoker, reply);
            return;
        }
        if (subCommand === 'off') {
            toggleSquadSystem(false, invoker, reply);
            return;
        }
        if (subCommand === 'division') {
            if (parts.length > 1 && parts[1].toLowerCase() === 'on') {
                activateDivisionMode(reply);
            } else if (parts.length > 1 && parts[1].toLowerCase() === 'off') {
                deactivateDivisionMode(reply);
            } else {
                reply('[Fleet Manager] Usage: !' + botName + ' division on/off');
            }
            return;
        }
        if (subCommand === '+') {
            createNewDivision(reply);
            return;
        }
        if (subCommand === 'help') {
            reply('[Fleet Manager] Commands: !' + botName + ' on, !' + botName + ' off, !' + botName + ' division on/off, !' + botName + '+, !' + botName + ' help');
            return;
        }
        reply('[Fleet Manager] Unknown command. Use !' + botName + ' help');
    }

    // ===== EVENTS =====
    event.on('chat', function(ev) {
        if (!ev || !ev.client || ev.client.isSelf()) return;
        var prefix = '!' + botName;
        var text = String(ev.text || '');
        if (text === prefix + '+') {
            handleCommand('+', ev);
            return;
        }
        if (text.indexOf(prefix + ' ') === 0) {
            var cmdText = text.substring(prefix.length + 1);
            handleCommand(cmdText, ev);
            return;
        }
        if (text === '!squadsystem on' || text === '!squadsystem off') {
            var parts = text.split(' ');
            handleCommand(parts[1], ev);
        }
    });

    event.on('clientMove', function(ev) {
        if (!state.squadSystemActive || !ev || !ev.client || ev.client.isSelf()) return;
        reconcileAll();
    });

    event.on('load', function(ev) {
        logMessage('Fleet Manager v1.0.0 loaded');
        if (backend.isConnected()) {
            initialize();
        } else {
            event.on('connect', function() {
                initialize();
            });
        }
    });

    // ===== INITIALIZATION =====
    function initialize() {
        logMessage('Fleet Manager: Initializing...');
        loadState();

        if (state.squadSystemActive) {
            logMessage('Fleet Manager: Fleet system was active. Restoring channels...', 3);

            // Try to discover existing channels
            var discovered = false;
            if (parentChannelId) {
                discovered = discoverManagedChannels();
            }

            if (!discovered) {
                logMessage('Fleet Manager: Could not discover managed channels. System remains inactive.', 2);
                state.squadSystemActive = false;
                return;
            }

            startReconciliation();

            // Initial reconciliation after short delay
            setTimeout(function() {
                reconcileAll();
            }, 2000);
        }
        logMessage('Fleet Manager: Initialization complete.', 3);
    }
});
