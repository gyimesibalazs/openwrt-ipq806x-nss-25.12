'use strict';
'require view';
'require fs';
'require poll';
'require dom';
'require ui';
'require uci';

// Renders the output of `nss-status -j` (the single source of truth for
// NSS plane health); this view only formats, it computes nothing itself.

function getStatus() {
	return fs.exec('/usr/sbin/nss-status', ['-j']).then(function(res) {
		if (res.code !== 0)
			throw new Error(res.stderr || 'nss-status failed');
		return JSON.parse(res.stdout);
	});
}

// ECM acceleration switch: the setting is ecm.global.enabled, flipped by
// /usr/libexec/luci-nss-ecm, which also restarts ECM.
var ecmEnabled = true;
var container = null;

function toggleEcm(on) {
	return fs.exec('/usr/libexec/luci-nss-ecm', [ on ? 'on' : 'off' ]).then(function(res) {
		if (res.code !== 0)
			throw new Error(res.stderr || 'luci-nss-ecm failed');
		ecmEnabled = on;
		return getStatus();
	}).then(function(d) {
		dom.content(container, renderStatus(d));
	}).catch(function(e) {
		ui.addNotification(null, E('p', [ e.message ]));
	});
}

function ecmSwitch(loaded) {
	var state = ecmEnabled
		? (loaded ? _('on') : _('on, but ECM is not loaded'))
		: _('off (flow offloading is left to the firewall)');

	return [
		state, ' ',
		E('button', {
			'class': 'btn cbi-button ' + (ecmEnabled ? 'cbi-button-negative' : 'cbi-button-positive'),
			'click': ui.createHandlerFn(null, toggleEcm, !ecmEnabled)
		}, ecmEnabled ? _('Turn off') : _('Turn on'))
	];
}

function stateBadge(state) {
	var map = {
		active:  ['#2e7d32', _('Offload active')],
		stalled: ['#c62828', _('Firmware armed but heartbeat silent — check the system log; a reboot returns to the host stack')],
		host:    ['#f9a825', _('Host stack (NSS plane not armed)')]
	};
	var m = map[state] || ['#757575', state];
	return E('div', {
		'style': 'display:inline-block;padding:.3em .8em;border-radius:.3em;color:#fff;font-weight:bold;background:' + m[0]
	}, [ m[1] ]);
}

// Every value below is device-derived (firmware version strings, netdev
// names, counters). LuCI's E() assigns a bare string to innerHTML and only
// builds text nodes for array members, so the brackets are load-bearing.
function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'min-width:30%' }, label),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ])
	]);
}

function onoff(v) {
	return v ? _('loaded') : _('not loaded');
}

function offl(pkts, pct) {
	return String(pkts) + ' (' + pct + '%)';
}

function renderStatus(d) {
	var cores = (d.cores || []).map(function(c) {
		return 'core' + c.core + ' ' + c.avg + '%';
	}).join(', ');

	var igs = (d.sqm.igs || []).map(function(i) {
		return i.port + (i.active ? ' ✓' : ' ✗');
	}).join('  ');

	// d.mesh: {configured, offloaded, fw_capable} - whether a mesh interface
	// is set up, whether ath11k got a firmware vdev for it, and whether the
	// loaded firmware offloads 802.11s mesh at all.
	var mesh = d.mesh || {};
	// ipq806x: the ath10k radios reach the firmware through NSS virtual
	// interfaces (the Wi-Fi redirect), not through wifili.
	var redir = d.wifi_redirect;
	var wifi = (redir && d.wifi_offload != 1) ?
	               (redir.interfaces > 0
	                   ? _('NSS redirect on %d interfaces (%s pkts to the firmware, %s from it)').format(redir.interfaces, redir.tx_pkts, redir.rx_pkts)
	                   : _('host mode (no NSS redirect interface)')) :
	           d.wifi_offload == 1 ?
	               (mesh.configured && mesh.offloaded ? _('NSS offload active (wifili, 802.11s mesh offloaded)') :
	                mesh.configured ? _('NSS offload active (wifili; 802.11s mesh configured, not offloaded)')
	                                : _('NSS offload active (wifili)')) :
	           d.wifi_offload == 0 ?
	               (mesh.configured && mesh.fw_capable ? _('host mode (mesh configured; firmware supports mesh offload)') :
	                mesh.configured ? _('host mode (mesh configured; this NSS firmware has no mesh offload)') :
	                                  _('host mode')) :
	           _('ath11k not loaded');

	// data-title lets the theme stack table rows into labeled cards on
	// narrow (mobile) screens.
	var portRows = (d.ports || []).map(function(p) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'data-title': _('Port') }, [ p.netdev ]),
			E('td', { 'class': 'td', 'data-title': 'if_num' }, [ String(p.ifnum) ]),
			E('td', { 'class': 'td', 'data-title': _('Started') }, [ p.started ? _('yes') : _('no') ]),
			E('td', { 'class': 'td', 'data-title': _('TX offloaded') }, [ offl(p.tx_offloaded, p.tx_offload_pct) ]),
			E('td', { 'class': 'td', 'data-title': _('TX via host') }, [ String(p.tx_host_pkts) ]),
			E('td', { 'class': 'td', 'data-title': _('RX offloaded') }, [ offl(p.rx_offloaded, p.rx_offload_pct) ]),
			E('td', { 'class': 'td', 'data-title': _('RX to host') }, [ String(p.rx_host_pkts) ])
		]);
	});

	// ipq50xx with the switch on DSA: the firmware has one VLAN node per
	// standalone switch port and per bridge (per VLAN on a VLAN-aware bridge),
	// carried inside the GMAC above. A bridge's ports share its node, so the
	// nodes are listed by bridge and the ports' wire totals in a table of
	// their own: the glue has no per-port exception counters there.
	var dsaNodeRows = (d.dsa_nodes || []).map(function(n) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'data-title': _('Node') }, [ n.name ]),
			E('td', { 'class': 'td', 'data-title': 'if_num' }, [ String(n.ifnum) ]),
			E('td', { 'class': 'td', 'data-title': 'VID' }, [ String(n.vid) ]),
			E('td', { 'class': 'td', 'data-title': _('Switch ports') }, [ (n.ports || []).join(' ') ])
		]);
	});
	var dsaPortRows = (d.dsa_ports || []).map(function(p) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'data-title': _('Port') }, [ p.netdev ]),
			E('td', { 'class': 'td', 'data-title': _('Link') }, [ p.carrier ? _('up') : _('down') ]),
			E('td', { 'class': 'td', 'data-title': _('TX packets') }, [ String(p.tx_total) ]),
			E('td', { 'class': 'td', 'data-title': _('RX packets') }, [ String(p.rx_total) ])
		]);
	});

	// Packets through the firmware's Wi-Fi data path per radio, since boot:
	// a Wi-Fi client never touches a switch port, so a fully offloaded Wi-Fi
	// download would otherwise read as an idle router. rx_reaped is every
	// frame off the radio's REO ring; rx_delivered only those handed to an
	// AP or STA interface, which an offloaded mesh link never is.
	var wifiliRows = (d.wifili || []).map(function(w) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'data-title': _('Radio') }, [ w.radio ]),
			E('td', { 'class': 'td', 'data-title': _('TX sent') }, [ String(w.tx_sent) ]),
			E('td', { 'class': 'td', 'data-title': _('RX (REO)') }, [ String(w.rx_reaped != null ? w.rx_reaped : '-') ]),
			E('td', { 'class': 'td', 'data-title': _('RX delivered') }, [ String(w.rx_delivered) ])
		]);
	});

	// ipq806x: the switch ports carry their traffic inside the conduit GMAC,
	// with no firmware node of their own. Wire totals come from the switch
	// MIB, the host share from its software counters, so a port's offloaded
	// traffic is the difference between the two.
	var switchPortRows = (d.dsa_nodes || []).length ? [] : (d.dsa_ports || []).filter(function(p) {
		return p.conduit != null;
	}).map(function(p) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'data-title': _('Port') }, [ p.netdev ]),
			E('td', { 'class': 'td', 'data-title': _('Conduit') }, [ p.conduit ]),
			E('td', { 'class': 'td', 'data-title': _('Link') }, [ p.carrier ? _('up') : _('down') ]),
			E('td', { 'class': 'td', 'data-title': _('TX packets') }, [ String(p.tx_total) ]),
			E('td', { 'class': 'td', 'data-title': _('TX via host') }, [ String(p.tx_host_pkts) ]),
			E('td', { 'class': 'td', 'data-title': _('RX packets') }, [ String(p.rx_total) ]),
			E('td', { 'class': 'td', 'data-title': _('RX to host') }, [ String(p.rx_host_pkts) ]),
			E('td', { 'class': 'td', 'data-title': _('RX FCS errors') }, [ String(p.rx_fcs_errors) ])
		]);
	});

	var switchSection = switchPortRows.length ? [
		E('h3', {}, _('Switch ports (DSA)')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Port')),
				E('th', { 'class': 'th' }, _('Conduit')),
				E('th', { 'class': 'th' }, _('Link')),
				E('th', { 'class': 'th' }, _('TX packets')),
				E('th', { 'class': 'th' }, _('TX via host')),
				E('th', { 'class': 'th' }, _('RX packets')),
				E('th', { 'class': 'th' }, _('RX to host')),
				E('th', { 'class': 'th' }, _('RX FCS errors'))
			])
		].concat(switchPortRows)),
		E('p', {}, E('em', {}, _('Packet totals are the switch\'s own counters for the port; "via host" / "to host" is what passed through the router\'s CPU. The rest of the port\'s traffic was forwarded by the firmware. FCS errors are damaged frames received from the cable.')))
	] : [];

	var sw = d.switch;
	var swErrors = sw ? (sw.rx_crc_errors || 0) + (sw.rx_fcs_errors || 0) : 0;
	var linkErrors = sw ? E('span', { 'style': swErrors ? 'color:#c62828;font-weight:bold' : '' }, [
		_('CRC on the GMACs: %d, FCS on the switch ports: %d').format(sw.rx_crc_errors, sw.rx_fcs_errors)
	]) : null;

	var wifiliSection = wifiliRows.length ? [
		E('h3', {}, _('Wi-Fi radios on the firmware')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Radio')),
				E('th', { 'class': 'th' }, _('TX sent')),
				E('th', { 'class': 'th' }, _('RX (REO)')),
				E('th', { 'class': 'th' }, _('RX delivered'))
			])
		].concat(wifiliRows)),
		E('p', {}, E('em', {}, _('Packets through the firmware\'s Wi-Fi data path since boot, per radio. "RX (REO)" is every frame the radio received; "RX delivered" counts only frames for an AP or STA interface, so frames of an offloaded 802.11s mesh link show up in the first column only.')))
	] : [];

	var dsaSection = dsaNodeRows.length ? [
		E('h3', {}, _('Switch ports and bridges on the firmware (DSA)')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Node')),
				E('th', { 'class': 'th' }, 'if_num'),
				E('th', { 'class': 'th' }, 'VID'),
				E('th', { 'class': 'th' }, _('Switch ports'))
			])
		].concat(dsaNodeRows)),
		E('p', {}, E('em', {}, _('Each standalone switch port reaches the firmware as its own VLAN node on the GMAC above. A bridge has one node that all its switch ports share, and a VLAN-aware bridge has one for each of its VLANs.'))),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Port')),
				E('th', { 'class': 'th' }, _('Link')),
				E('th', { 'class': 'th' }, _('TX packets')),
				E('th', { 'class': 'th' }, _('RX packets'))
			])
		].concat(dsaPortRows)),
		E('p', {}, E('em', {}, _('The offloaded share is part of the GMAC\'s figures above; the totals here are each port\'s own switch counters, all its VLANs together.')))
	] : [];

	return E('div', {}, [
		E('p', {}, stateBadge(d.state)),
		E('table', { 'class': 'table' }, [
			row(_('Firmware'), d.fw_version + ' (fw_mask ' + d.fw_mask + ')'),
			row(_('Heartbeat'), _('%s pkts/s (NSS→host)').format(d.heartbeat_pps)),
			row(_('NSS core load'), cores || '-'),
			row(_('ECM acceleration'), ecmSwitch(d.ecm.loaded)),
			row(_('ECM accelerated connections'), d.ecm.loaded
				? _('%s IPv4 / %s IPv6 / %s multicast').format(d.ecm.ipv4_accel, d.ecm.ipv6_accel, d.ecm.multicast_accel)
				: _('ECM not loaded')),
			linkErrors
				? row(_('Link errors') + (sw.tagging ? ' (' + sw.tagging + ')' : ''), linkErrors)
				: E('tr', { 'style': 'display:none' }),
			row(_('Bridge offload (bridge-mgr)'), onoff(d.modules.bridge_mgr)),
			row(_('PPPoE manager'), onoff(d.modules.pppoe)),
			row(_('Wi-Fi data path'), wifi),
			row(_('SQM shaper'), d.sqm.active
				? (d.sqm.lanes
					? _('nsstbl on %s (a lane on the switch conduit %s)').format(d.sqm.device, d.sqm.shaping_device)
					: _('nsstbl on %s').format(d.sqm.device)) +
					(igs ? ' — ' + _('upload IGS: %s').format(igs) : '')
				: !d.sqm.enabled
					? _('off (no queue enabled in /etc/config/sqm)')
					: (d.sqm.device ? _('no NSS shaper on %s').format(d.sqm.device) : _('no NSS shaper'))),
			(d.sqm.fastlane && d.sqm.fastlane.active)
				? row(_('Fast lane'), _('egress %s pkts / ingress %s pkts — %s marking rules').format(
					d.sqm.fastlane.egress_pkts, d.sqm.fastlane.ingress_pkts, d.sqm.qos_marking_rules || 0))
				: E('tr', { 'style': 'display:none' })
		]),
		E('h3', {}, _('Firmware-attached ports')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Port')),
				E('th', { 'class': 'th' }, 'if_num'),
				E('th', { 'class': 'th' }, _('Started')),
				E('th', { 'class': 'th' }, _('TX offloaded')),
				E('th', { 'class': 'th' }, _('TX via host')),
				E('th', { 'class': 'th' }, _('RX offloaded')),
				E('th', { 'class': 'th' }, _('RX to host'))
			])
		].concat(portRows.length ? portRows : [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': '7' }, _('No ports attached — host stack'))
			])
		])),
		E('p', {}, E('em', {}, _('Offloaded packets are forwarded by the firmware and never reach the host. "via host" / "to host" is the host↔firmware exception path — what was not offloaded — so low numbers there mean offload is working. Broadcast and multicast discovery, connection setup, short-lived flows and traffic addressed to the router itself always take that path: a flow is only offloaded once it is established, so a quiet port that carries little else shows a low offloaded share. Port totals are on Status → Overview.')))
	].concat(wifiliSection, dsaSection, switchSection));
}

// The diagnostics reports: 'nss-status -d' (the status plus firmware, GMAC,
// switch, ECM and kernel log snapshots) and 'nss-status -l2' (per-port
// datapath counters), as text to read here or download and attach to a
// bug report.
function runReport(out, args, name) {
	dom.content(out, E('em', { 'class': 'spinning' }, _('Collecting…')));

	return fs.exec('/usr/sbin/nss-status', args).then(function(res) {
		var text = res.stdout || res.stderr || '';
		var blob = new Blob([ text ], { type: 'text/plain' });

		dom.content(out, [
			E('p', {}, E('a', {
				'class': 'btn cbi-button',
				'href': URL.createObjectURL(blob),
				'download': name
			}, _('Download'))),
			E('pre', { 'style': 'white-space:pre;overflow:auto;max-height:40em;font-size:85%' }, [ text ])
		]);
	}).catch(function(e) {
		dom.content(out, E('p', { 'class': 'alert-message warning' }, [ e.message ]));
	});
}

function renderDiagnostics() {
	var out = E('div', {});

	return E('div', {}, [
		E('h3', {}, _('Diagnostics')),
		E('p', {}, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(null, runReport, out, [ '-d' ], 'nss-status.txt')
			}, _('Full report')),
			' ',
			E('button', {
				'class': 'btn cbi-button',
				'click': ui.createHandlerFn(null, runReport, out, [ '-l2' ], 'nss-status-l2.txt')
			}, _('Per-port datapath'))
		]),
		out
	]);
}

return view.extend({
	load: function() {
		return Promise.all([ getStatus(), uci.load('ecm') ]);
	},

	render: function(data) {
		ecmEnabled = uci.get('ecm', 'global', 'enabled') !== '0';
		container = E('div', {}, renderStatus(data[0]));

		poll.add(function() {
			return getStatus().then(function(d) {
				dom.content(container, renderStatus(d));
			});
		}, 10);

		return E('div', {}, [
			E('h2', {}, _('NSS Offload')),
			container,
			renderDiagnostics()
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
