# OpenWrt master with Qualcomm NSS offload for ipq806x

This repository contains OpenWrt **master** (Linux **6.18.55**, mac80211 backports
7.2) with the Qualcomm **NSS** (Network Subsystem) hardware offload for the
**ipq806x** platform (IPQ8064/IPQ8065). It targets the Netgear R7800 and the
TP-Link Archer C2600.

> **This is the `dsa-main` branch**, a port of the `dsa-lab` branch
> (OpenWrt 25.12.6, Linux 6.12) to OpenWrt master. The C2600 image boots and
> routes with NSS offload: 938 Mbit/s upload and 843 Mbit/s download through
> NAT, all of it offloaded, with no CRC errors. The R7800 image builds but has
> not been booted yet. See
> [Port to OpenWrt master and Linux 6.18](#port-to-openwrt-master-and-linux-618).
>
> The C2600 and R7800 run the switch with **DSA** instead of swconfig, and NSS
> still accelerates it. The test results below were taken on `dsa-lab`: on the
> TP-Link Archer C2600 by the author, and users have reported the R7800 stable
> on that branch as well. See
> [DSA with NSS on the C2600](#dsa-with-nss-on-the-c2600-experimental).

The original OpenWrt README is kept as [README.openwrt.md](README.openwrt.md).

## Where this comes from

- **Base:** upstream [openwrt/openwrt](https://github.com/openwrt/openwrt),
  OpenWrt 25.12.6 (`r33311`). The earlier 25.12.5 port is kept on the
  `r7800-nss-25.12` branch.
- **NSS support:** taken from the `r7800-24.10.8` branch of
  [tingalvin/r7800](https://github.com/tingalvin/r7800), which was written for
  OpenWrt 24.10. That branch is the work of Lucas Asvio (asvio), SqTER-PL and
  reflector (tingalvin). On the `dsa-lab` and `r7800-nss-25.12` branches
  their commits keep their original authors. This branch carries the result
  over to master in a few port commits, so see those branches for the
  per-commit history.
- **This repository** ports that work to 25.12, Linux 6.12 and backports 6.18,
  then to master, Linux 6.18 and backports 7.2, adds the C2600, and fixes what
  broke on the newer kernels.

The R7800 NSS builds go back several generations:

```
ACwifidude/openwrt       R7800 NSS for OpenWrt 22.03 / 23.05 (kernel 5.10–5.15)
 └─ asvio/R7800-nss       fork: r7800-23.05-nss … r7800-24.10-nss, r7800-k6.x-nss
     └─ tingalvin/r7800   OpenWrt 24.10.4 … 24.10.8
         └─ this repo     OpenWrt 25.12.6, Linux 6.12, + TP-Link Archer C2600
```

- [ACwifidude/openwrt](https://github.com/ACwifidude/openwrt): the original R7800
  NSS work.
- [asvio/R7800-nss](https://github.com/asvio/R7800-nss): continued it through
  23.05 and 24.10 and started the move to 6.x kernels.
- [tingalvin/r7800](https://github.com/tingalvin/r7800): kept it current with the
  24.10 point releases.
- NSS package sources:
  [asvio/nss-packages](https://github.com/asvio/nss-packages) (`NSS-12.5-K6.x`),
  which came from
  [ACwifidude/nss-packages](https://github.com/ACwifidude/nss-packages).

The NSS code was not merged from git history. It was carried over commit by
commit, so this branch descends from OpenWrt 25.12, not from the 24.10 fork.

## What was changed

### Port to OpenWrt master and Linux 6.18

The `dsa-lab` tree was carried over to master, which moved from Linux 6.12 to
6.18, from backports 6.18 to 7.2 and the board DTS files out of the kernel tree
into `target/linux/ipq806x/dts/`.

- **Kernel patches:** the NSS patches were rebuilt on 6.18.55 by cherry-picking
  each one from an exact 6.12.112 tree, so every patch was merged against its
  real base. Ten needed manual merges:
  - the bridge Hy-Fi hook now keeps master's VLAN 0 local FDB fallback;
  - the IPv6 route notifier goes into `ipv6_route_ioctl()`, which no longer
    takes RTNL;
  - fast-xmit, shortcut-fe, VLAN untag and 6RD/DS-Lite hooks were placed in the
    reworked `net/core/dev.c` and `ip6_tunnel.c`;
  - the bonding LAG callbacks sit next to master's 802.3ad peer notification;
  - `ipmr.c` gets a forward declaration, because `ipmr_get_table()` now comes
    after the multicast offload functions.
- **Dropped:** `990-0188` (IPv4 default checks). It only adapted the legacy
  iptables match bypass, and master removed that patch.
- **DTS:** `990-0001` was split. The SoC `.dtsi` parts stay a kernel patch and
  the board parts are applied to `target/linux/ipq806x/dts/`.
- **`mdiobus` property:** master removed it from 14 board DTS files as unused.
  nss-gmac reads it and fails to probe without it, so the removal is reverted.
- **qca8k tag_8021q:** the patch is now `pending-6.18/769-…`. It has to apply
  after master's MxL862xx tagger, which takes tag values 30 and 31, so
  `qca-8021q` is 32. Master also gained `711-04`, which skips host FDB entries
  on CPU ports. Unknown unicast goes only to the CPU ports, so this is safe with
  two NSS conduits, and the bridge database is mapped to its tag_8021q VLAN
  before the stale-entry purge.
- **NSS packages on 6.18:**
  - Linux 6.15 dropped `EXTRA_CFLAGS`, so every NSS package lost its include
    paths and `-Wno-*` flags. They are now passed as `CFLAGS_MODULE` as well.
    mac80211 gets the NSS include path the same way.
  - nss-drv: the dummy NAPI netdev is allocated with `alloc_netdev_dummy()`.
    The skb recycle code was checked against 6.18: the skb and shared info
    init is unchanged from 6.12, so 6.18 was added to its allowed versions.
  - nss-gmac: `phy_register_fixup()` is no longer exported. The fixup is
    registered by bus id and does the PHY ID match itself. Threaded NAPI uses
    the new `dev_set_threaded()` enum.
  - timer API renames (`timer_delete_sync()`, `timer_container_of()`) in
    qca-mcs, ECM and clients, `first_net_device_rcu()` in nss-qdisc,
    `rtnl_link_register()` in nss-ifb and a missing crypto header in
    cryptoapi.
- **WiFi stack:** the QAM-256 on 2.4 GHz patch was ported to backports 7.2,
  where the bandwidth check moved to `ieee80211_sta_bw_capability()`. Patch
  `201` was dropped, because the function it changed is gone and the new check
  already covers its case. The ath10k-ct patches were retargeted to the
  `ath10k-7.2` tree.
- **Kernel Rust:** master builds the kernel with Rust by default. On arm32 the
  Rust objects use a 4-byte `wchar_t` and the kernel a 2-byte one, so vmlinux
  fails to link. The config seeds turn it off (`CONFIG_KERNEL_RUST`, which
  needs `DEVEL` and `RUST_TOOLCHAINOPTS` to be visible).
- **Package repository:** the seeds leave `CONFIG_VERSION_REPO` at master's
  snapshots default. A 25.12 repository would offer kmods built for another
  kernel.

### Port to 25.12 and Linux 6.12

- **Kernel:** all 77 NSS/ECM patches of `target/linux/ipq806x/patches-6.12/` were
  ported and refreshed. This covered:
  - ARM cache hooks moved to C;
  - `dev->lltx`;
  - per-CPU PPP stats;
  - vxlan, bridge, bonding, gre and tun context changes.
- **GCC 14:** the NSS kernel patches were fixed so they build under `-Werror`.
- **Switch:** the DTS files use swconfig instead of DSA, as in the 24.10 NSS
  branch, and the 25.12 pinctrl and PCIe changes are kept. Linksys E8350-v1 has
  no swconfig DTS, so it stays on DSA without NSS. On this branch the C2600 is
  back on DSA, with NSS (see below).
- **NSS packages:**
  - qca-nss-gmac, -drv, -clients, -ecm, -crypto, -cfi and qca-mcs were ported to
    6.12 (`.remove` returns void, `strscpy`, `no_llseek`, tracepoints, and so on);
  - since Linux 6.11, sysctl tables no longer end with a `{}` sentinel. Without
    this fix nss-gmac fails to probe and **no ethernet port comes up**.
- **WiFi stack:**
  - the mac80211 NSS redirect patch was refreshed for backports 6.18;
  - the ath10k-ct patches were retargeted to the `ath10k-6.18` tree;
  - the wifi-script tweaks were moved to the ucode scripts.
- **LuCI:** the VHT/QAM-256 on 2.4 GHz patch is in
  `VHTNSS.zip`.
- **Branding:** images are named `openwrt-nss-…` and report
  `OpenWrt NSS 25.12.6`.
- **25.12.6 rebase:** two kernel patches were adapted to 6.12.112:
  - the bridge Hy-Fi hook now uses `READ_ONCE(dst->dst)`;
  - the bonding LAG acceleration was adapted to the RCU `port->aggregator`
    and the new 802.3ad neighbour broadcast.

  The new Aruba AP-32x has no switch, so it uses the swconfig `eth1`/`eth0`
  layout.

### Fixes found while testing on the C2600

1. **`dev.nss.rps.pri_map` sysctl.**
   - Problem: the sysctl used user-copy helpers on the kernel buffer that
     sysctl handlers have received since Linux 5.8. Every read printed a kernel
     WARN and returned `Bad address`.
   - Fix: [qca-nss-drv patch 132](package/qca-nss/qca-nss-drv/patches/132-kernel-6.12-fix-rps-pri-map-sysctl.patch).
2. **Exception traffic used only one CPU.**
   - Problem: OpenWrt's generic packet steering pinned RPS on the NSS ethernet
     ports to CPU0. This pulled traffic that NSS had already queued for CPU1
     back to CPU0. On top of that, the second NSS core's IRQ also sat on CPU0.
   - Fix: a platform hook,
     [`/usr/libexec/platform/packet-steering.sh`](package/qca-nss/qca-nss-drv/files/qca-nss-drv.packet-steering),
     and an IRQ affinity line in `qca-nss-drv.init`.
   - Result: NAT connection churn rose from ~2,000 to ~3,200 new
     connections/s, with 0 failed connections.
3. **ath10k-ct instead of mainline ath10k on the C2600.**
   - Problem: the only non-CT firmware for the QCA99X0 radio is the 2016
     `10.4.1.00030` build. It does no TX A-MPDU aggregation, so the 5 GHz
     download was stuck at **34 Mbit/s** on an 866 Mbit/s link.
   - Fix: switched to ath10k-ct with the CT firmware (`diff-c2600`).
   - Result: ~580 Mbit/s down and ~620 Mbit/s up. The R7800 seed still uses
     mainline ath10k, because its QCA9984 firmware does not have this problem.
4. **Threaded NAPI for ath10k-ct on PCI.**
   - Problem: on ipq806x every PCIe MSI is chained through one interrupt pinned
     to CPU0, so the WiFi IRQ cannot be moved to the other core.
   - Fix: [patch 970](package/kernel/ath10k-ct/patches/970-ath10k-ct-pci-enable-threaded-napi.patch)
     runs the radio's NAPI in a kernel thread instead.
   - Result: WiFi upload load on CPU0 dropped from 68% to ~10%, at the same
     throughput.
5. **ECM firewall script.** With fw4 there is no `iptables`, so the iptables
   lines now run only when the binary exists.

## DSA with NSS on the C2600 (experimental)

### Why NSS builds stayed on swconfig

Upstream OpenWrt has used DSA for the ipq806x switch (QCA8337, driver `qca8k`)
since 23.05. The NSS builds this repository descends from all kept swconfig,
for three reasons:

1. **The QCA header.** `qca8k` marks the frames between the switch and the
   CPU with a 2-byte proprietary header in place of the EtherType. The NSS
   firmware is closed and does not understand it, so nothing can be
   accelerated.
2. **ECM knows nothing about DSA.** It cannot tell that `lan1` lives on
   `eth1`. Under swconfig the same port is `eth1.1`, a VLAN device that ECM
   handles.
3. **The NSS drivers were only ever run without DSA.** Several of their bugs
   only show up when a DSA switch sits behind them (see below).

### The approach: make DSA look like swconfig to NSS

NSS was not taught about DSA. The switch and DSA were set up so that NSS sees
what it saw under swconfig: plain 802.1Q-tagged frames on the GMACs.

- **A VLAN-based tagger.** The kernel already has a pattern for this
  (`tag_8021q`, used by sja1105 and vsc73xx). A new `qca-8021q` tagger
  replaces the QCA header with VLAN tags. Every standalone port gets its own
  VLAN from the reserved range 3072–4095, and each bridge gets one shared VLAN.
  On the C2600 that is VLAN 3088 for `br-lan` on `eth1` and VLAN 3077 for `wan`
  on `eth0`. To NSS this is the same as swconfig's `eth1.1` and `eth0.2`.
- **ECM** presents a DSA user port as a VLAN of its conduit, so it builds the
  same NSS rules as for `eth1.1`.

### VLAN limits

- **VLAN IDs 1–3071** are available for user VLANs. The tagger uses
  3072–4095, and the driver refuses them for anything else.
- **Count.** The driver sets no limit of its own. If the switch reports its
  VLAN table full, adding the VLAN fails with an error. The table size of the
  QCA8337 has not been checked. The tagger itself uses one VLAN per port
  (5 on the C2600) and one per bridge.
- **One standalone port per VLAN ID.** A VLAN upper of a standalone port, such
  as `wan.35`, reaches the CPU with just its own tag, and the tagger finds the
  port from the VLAN ID. The same ID therefore cannot be used on two standalone
  ports. Ports in one VLAN-aware bridge can share IDs.
- **Up to 7 offloaded bridges.** The bridge number is encoded in 3 bits of the
  bridge VLAN.
- **NSS acceleration.** VLAN uppers of standalone ports are accelerated. Traffic
  through ports of a VLAN-aware bridge is not, because there the VLAN depends
  on the flow. Neither case has been tested on hardware yet.

### What it took on the hardware

None of this is documented clearly. It was found on the device from kernel
logs, register dumps and packet captures.

**QCA8337 switch** ([kernel patch 769](target/linux/generic/pending-6.18/769-net-dsa-qca8k-add-tag_8021q-tagging.patch)):

- **Egress mode.**
  - Problem: the VLAN table decides the egress tagging only in the "untouched"
    egress mode, which is set in two registers (`PORT_VLAN_CTRL1` and
    `0x0c80`). In the default "unmodified" mode a frame leaves as it came in,
    so the CPU got every frame untagged. swconfig never saw this because it
    resets the switch; `qca8k` does not.
  - Fix: both registers are set to "untouched".
- **Flooding.**
  - Problem: with the QCA header the CPU picks the egress port of every frame,
    so upstream floods broadcast and unknown traffic to the CPU ports only.
    With VLANs the switch must forward the CPU's frames itself, and without
    flooding to every port not even a DHCP discover left the router.
  - Fix: the switch floods to every port.
- **Bridge number.**
  - Problem: `qca8k` did not set `max_num_bridges`, so the bridge VLAN carried
    no bridge number and the tagger could not decode it.
  - Fix: `max_num_bridges` is set.
- **Two CPU ports.**
  - Problem: in VLAN (secure) mode the switch ignores the port masks, and DSA
    puts every tag_8021q VLAN on every CPU port. Each frame reached both GMACs:
    WAN pings came back twice, and LAN frames arrived on the wrong conduit.
  - Fix: a VLAN is kept only on the CPU port its ports use, and moves with
    them on a conduit change.
- **VLAN table entries.**
  - Problem: in the VLAN table, egress mode 0 means "member, unmodified", so a
    new all-zero entry made every port a member.
  - Fix: new entries start with no members.
- **Multi-register reads**
  ([kernel patch 716](target/linux/generic/pending-6.18/716-net-dsa-qca8k-fix-the-MDIO-bulk-read-offset.patch)).
  - Problem: without the QCA header there is no register access over
    Ethernet, so every bulk read falls back to MDIO, and that fallback stored
    the registers one byte apart. The FDB dump, the FDB search and the
    multicast (MDB) entries read garbage. The bug is in mainline too; it was
    pointed out on the OpenWrt forum.
  - Fix: the buffer is indexed as 32-bit words.
- **RGMII I/O voltage**
  ([kernel patches 714-01/02](target/linux/generic/pending-6.18/714-02-net-dsa-qca8k-make-mac-pwr-sel-configurable-from-dt.patch),
  from upstream PR [#26259](https://github.com/openwrt/openwrt/pull/26259)).
  - Problem: qca8k picks the MAC_PWR_SEL voltage bits from the SoC
    compatible. On the C2600 that gives 0x000aa545 instead of the swconfig
    0x0006a545: the GMAC behind port 0 counted CRC errors, and WAN stopped
    receiving after a few hours. The SoC does not decide it, the board
    wiring does: the R7500v2 is an IPQ8064 too, but needs the other value.
  - Fix: two DT flags, `qca,mac-pwr-sel-rgmii0-1p8v` and
    `qca,mac-pwr-sel-rgmii1-1p8v`, set per board to its swconfig initvals.

**NSS drivers:**

- **The netdev parent**
  ([nss-gmac patch 10](package/qca-nss/qca-nss-gmac/patches/10-set-netdev-parent.patch)).
  - Problem: nss-gmac set the netdev parent to the MDIO bus device, a
    workaround for an old PHY attach crash. DSA looks up its conduit through
    the GMAC's DT node, never found it, and the switch probe was deferred
    forever.
  - Fix: the parent is the GMAC platform device.
- **`of_get_phy_mode()`.**
  - Problem: an old NSS kernel hack made it return the mode index instead of
    0. DSA took that for an error ("CPU port lacks the required phy-mode"),
    and the switch probe failed with `-EINVAL`. Current nss-gmac does not need
    the hack.
  - Fix: the hack was dropped.
- **MTU**
  ([nss-gmac patch 09](package/qca-nss/qca-nss-gmac/patches/09-set-max-mtu.patch)).
  - Problem: nss-gmac left `max_mtu` at 1500, so DSA could not make room for
    the 4-byte tag on the conduit.
  - Fix: `max_mtu` is raised to the driver's jumbo limit.
- **Device tree.**
  - Problem: the NSS device tree made nss-gmac attach to MDIO addresses 4 and
    0. These are the switch's internal PHYs of the `wan` and `lan4` ports,
    which DSA attaches to those user ports.
  - Fix: the GMACs are conduits without a PHY (`phy-mdio-addr = <32>`).

**ECM** ([patch 402](package/qca-nss/qca-nss-ecm/patches/402-dsa-tag_8021q-user-ports-as-vlans.patch)):
treats a DSA user port as a VLAN of its conduit. A VLAN upper of a standalone
port, such as `wan.35`, reaches the conduit with just its own tag.

### Method

The work was done in this order, so that each layer was proven before the next
one was added:

1. **Vanilla first.** The tagger was brought up on plain OpenWrt 25.12.6 with
   the stock `stmmac` Ethernet driver and no NSS. This separated switch and
   tagger bugs from NSS bugs. All five switch problems above were found and
   fixed there.
2. **Then NSS.** The same kernel patch went into the NSS build. The remaining
   problems were then in the NSS drivers.
3. **Diagnostics that survive a dead network.** A diagnostic image contained:
   - a WiFi access point on its own network, so the router stayed reachable
     with the wired side down;
   - a boot script that mounts a USB stick early and streams `/dev/kmsg` to
     it with synchronous writes, plus the previous boot's ramoops/pstore;
   - `tcpdump` captures of both GMACs, written to the stick;
   - during the switch work, temporary kernel logging of every VLAN-table
     write and a dump of the VLAN-related switch registers.

   The router was flashed over TFTP recovery, booted, and the stick was then
   read on a PC. Every fix above came from one of these logs, not from
   guessing. The diagnostic overlay is not part of the repository.

### Results (C2600, same setup as the swconfig tests above)

| Test | swconfig + NSS | DSA + NSS |
|---|---|---|
| NAT, 1 stream, up / down | 938–941 / 841–844 Mbit/s | 871 / 839 Mbit/s |
| NAT, 4 streams, up / down | – | 921 / 864 Mbit/s |
| NAT, bidirectional 4+4 | 938 / 916 Mbit/s | 916 / 908 Mbit/s |
| Router CPU during NAT | ~0–5% | 1–2% |
| WiFi 5 GHz, 1 stream, down / up | 569–582 / 531–621 Mbit/s | 514–583 / 463–565 Mbit/s |
| Ping over WiFi during download | 21 ms | 6–10 ms |

For comparison, the same DSA tagger without NSS (vanilla, CPU routing) reached
742 / 528 Mbit/s with the CPU at about 90%.

### Known issues and open points

- **Rare damaged frames.** Under bidirectional wired load about one frame in
  200,000 reaches the host damaged: always 1298 bytes, which looks like a
  1522-byte frame without its first 224 bytes. The tagger drops it with a
  "Couldn't decode source port" warning. It is not known yet whether swconfig
  had the same thing silently.
- **Not tested yet:**
  - VLAN-aware bridges and VLAN uppers such as `wan.35` (the code is there);
  - long load runs;
  - reboot cycles;
  - upgrading from an official 25.12 image.
- **No switch register access over Ethernet.** It needs the QCA header, so the
  switch is managed over MDIO only.
- **Other boards.** The Netgear R7800, XR450 and XR500 share the C2600's switch
  layout: CPU port 0 on `eth0` (RGMII), CPU port 6 on `eth1` (SGMII), and
  ports 1–5 as `lan4`–`lan1` and `wan`. They are converted the same way
  (nighthawk DTS, NSS DT patch, network, LEDs and config conversion), but
  none of them has been booted with it yet. Other ipq806x boards with a
  QCA8337 should work alike, given their port map in `05_swconfig-to-dsa`
  and the DTS changes.

## SQM with NSS

The images include `luci-app-sqm` and the `nss-rk.qos` script from
[rickkdotnet/sqm-scripts-nss](https://github.com/rickkdotnet/sqm-scripts-nss).
It shapes with the NSS qdiscs (`nsstbl` and `nssfq_codel`), so the shaped
traffic stays on the NSS cores. Upload is shaped on the interface itself,
download on `nssifb`.

### Setting it up in LuCI (Network → SQM QoS)

- **Interface:** `eth0`. Do not use `wan`: `nss-ifb` only works on the `eth`
  devices. On the C2600 and the R7800 `eth0` carries only the WAN traffic.
- **Speeds:** download and upload at about 90–95% of the line speed.
- **Queue discipline tab:** `fq_codel` as the queue discipline and
  `nss-rk.qos` as the script.

ECN, DSCP classification and link layer adaptation are not supported by the
script.

### Test (C2600, DSA, shaped to 400 Mbit/s each way, 4 TCP streams)

| | No SQM | SQM 400/400 |
|---|---|---|
| Upload | 921 Mbit/s | 365 Mbit/s |
| Download | 832 Mbit/s | 365 Mbit/s |
| Router CPU | 0% | 0–1% |
| Ping during load | 1–2 ms | 1–3 ms |

The shaper holds the set rate with no CPU load, and ECM keeps the flows
accelerated. In this test setup the line itself is never the bottleneck, so
the latency benefit on a slower uplink has not been measured.

## NSS status page

`nss-status` (package `nss-tools`) reports the state of the NSS data plane:
firmware and heartbeat, NSS core load, the offloaded share per GMAC, the
switch ports, CRC errors on the GMACs and FCS errors on the switch ports, ECM,
the Wi-Fi redirect and the NSS SQM shaper. `nss-status -l2` lists the
counters per port, `nss-status -d` adds a diagnostics snapshot to attach to a
bug report.

It has the interface of `nss-status` from the qualcommax NSS builds
([kuncy7/openwrt-nss-edma](https://github.com/kuncy7/openwrt-nss-edma)): the
same options and JSON, with the ipq806x data in keys of their own. Their
`luci-app-nss` is included with additions for ipq806x: **Status → NSS
Offload** shows the report, a switch port table and the link errors, and runs
the diagnostics reports; **Status → Overview** gets the NSS core load, the
ECM-accelerated connections and the SoC temperatures.

The offloaded share of a GMAC is its total traffic minus what passed through
the host on its switch ports: the GMAC counters are synced by the firmware and
count every frame, the qca8k port counters only count what went through the
CPU.

## Building

Build on a Debian or Ubuntu host with the
[usual OpenWrt build dependencies](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem).

```sh
git clone <this repository> openwrt-nss && cd openwrt-nss
./scripts/feeds update -a && ./scripts/feeds install -a
unzip -o VHTNSS.zip            # LuCI tweaks

cp diff-c2600 .config          # TP-Link Archer C2600
# cp diff .config              # Netgear R7800 (untested on hardware)
make defconfig
make -j$(nproc) download
make -j$(nproc)
```

The images are written to `bin/targets/ipq806x/generic/openwrt-nss-ipq806x-generic-*`.

## Installing on the TP-Link Archer C2600

- **From OpenWrt:** use `sysupgrade` with the `…-squashfs-sysupgrade.bin` image.
  - This branch uses DSA like the official 25.12 images, with the same port
    names (`lan1`–`lan4`, `wan`). Coming from an official image should keep the
    config, but this has not been tested.
  - Coming from a swconfig NSS image (the release branch), the config is
    converted on the first boot and the old one is kept as
    `/etc/config/network.swconfig`:
    - `eth1.1` becomes `lan1`–`lan4` and `eth0.2` becomes `wan`;
    - a VLAN tagged on one port only becomes a VLAN upper, e.g. `eth0.35`
      with `5t` becomes `wan.35`;
    - VLANs on trunk ports (tagged on several ports, or a port in several
      VLANs) become `br-lan` with VLAN filtering and a `bridge-vlan` section
      per VLAN, and `eth1.3` becomes `br-lan.3`. NSS does not accelerate
      traffic through a VLAN-aware bridge, and this has not been tested on
      hardware yet;
    - setups that cannot be converted (a VLAN ID used on two single ports,
      VLAN IDs 3072–4095) get the default config.

    The image reports compat version 1.0, so `sysupgrade` may need
    `uci set system.@system[0].compat_version=1.0` first.
- **From the stock firmware, or for recovery:**
  1. Rename `…-squashfs-factory.bin` to `ArcherC2600_1.0_tp_recovery.bin` and
     serve it from a TFTP server at `192.168.0.66`.
  2. Hold the Reset button while you power the router on.
- **First boot after flashing takes about 3 minutes.** JFFS2 erases the empty
  overlay blocks once (about 145 s on this flash). Later boots take about a
  minute.

## What was tested and measured (TP-Link Archer C2600)

### Setup

- PC → C2600 LAN (wired, or 5 GHz WiFi) → NAT → C2600 WAN → test server.
- Tools: `iperf3`, plus a connection-churn client that keeps 256 short TCP
  sessions open in parallel.
- During each test the router was sampled for:
  - per-CPU load;
  - NSS drop counters;
  - ECM connection counts;
  - memory and slab usage;
  - temperature;
  - kernel log.

### Wired, NAT routed by NSS

| Test | Result | Router |
|---|---|---|
| TCP, 1 stream, upload | 938–941 Mbit/s | CPU ~0–5% |
| TCP, 1 stream, download | 841–844 Mbit/s | CPU ~0–5% |
| TCP bidirectional, 4+4 streams, **30 min** | 938 up / 916 down Mbit/s | CPU 0–3%, 52–56 °C, no NSS drops, no kernel messages, memory back to baseline |
| UDP 64-byte packets, LAN→WAN | no drops on the router | loss only at the endpoints |
| Connection churn, 10 min | 1.36 M connections, ~2,300/s | before fix 2 |
| Connection churn, after fix 2 | ~3,200 new connections/s, 0 failures | load on both CPUs |

### WiFi 5 GHz (ath10k-ct, VHT80, 2×2 client at MCS 9 / 866 Mbit/s)

| Test | mainline ath10k | ath10k-ct (final) |
|---|---|---|
| TCP download | **34 Mbit/s** | **569–582 Mbit/s** |
| TCP upload | 231 Mbit/s | 531–621 Mbit/s |
| Bidirectional, 10 min | ~200 up / ~5 down (stopped after 1 min) | 463 up / 59 down (client upload takes most of the airtime) |
| UDP upload | – | 452 Mbit/s, 0.04% loss |
| UDP download, 1 flow, 800 Mbit/s offered | – | ~260 Mbit/s (limited by one CPU core) |
| Connection churn over WiFi | – | 68,537 connections, 0 failures |
| Ping during download | 60 ms | 21 ms |

The final image showed:

- no kernel warnings, Oops or BUGs;
- no NSS queue drops in the TCP tests;
- temperature between 45 and 51 °C;
- stable behaviour through several reboots and sysupgrades.

### Known limits and notes

- **No full NSS WiFi offload.** WiFi uses the *NSS redirect*: the ath10k driver
  and mac80211 run on the CPU and hand frames to NSS through a virtual
  interface. Full WiFi offload on ipq806x needs Qualcomm's closed qca-wifi
  driver.
- **A single flow runs on one CPU** wherever the host is involved (WiFi, or
  traffic NSS does not accelerate). A single 800 Mbit/s UDP download over WiFi
  reaches ~260 Mbit/s. Many parallel flows are spread over both cores.
- **One-way UDP is not accelerated.** The ECM init script sets
  `accel_delay_pkts=1`, so a UDP flow is accelerated only after ECM has seen
  traffic in both directions. This is deliberate, for DSCP/QoS. Real
  bidirectional UDP such as QUIC is accelerated after a few packets. Purely
  one-way streams, such as `iperf3 -u -R`, stay on the CPU.

### 25.12.6 check

The measurements above were taken on 25.12.5. The 25.12.6 image was then
installed on the C2600 with `sysupgrade`, keeping settings, and checked again:

- clean kernel log;
- all NSS fixes active;
- WiFi TCP download 569–573 Mbit/s, upload 597 Mbit/s;
- UDP download (one flow) 235 Mbit/s;
- connection churn: 68,659 connections, 0 failures.

The wired path was not re-measured.

### Not tested yet

- The 2.4 GHz radio.
- Long-term operation over several days.
- Repeated reboot cycles.
- The Netgear R7800 on real hardware.

## License

OpenWrt and the NSS packages keep their original licenses (see
[LICENSES](LICENSES) and the individual packages).
