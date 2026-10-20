# OpenWrt 25.12 with Qualcomm NSS offload for ipq806x

This repository contains OpenWrt **25.12.5** (Linux **6.12.94**, mac80211 backports
6.18) with the Qualcomm **NSS** (Network Subsystem) hardware offload for the
**ipq806x** platform (IPQ8064/IPQ8065). It targets the Netgear R7800 and the
TP-Link Archer C2600.

So far it has been tested on real hardware **only on the TP-Link Archer C2600**.
The R7800 build compiles but has not been booted yet.

The original OpenWrt README is kept as [README.openwrt.md](README.openwrt.md).

## Where this comes from

- **Base:** upstream [openwrt/openwrt](https://github.com/openwrt/openwrt),
  OpenWrt 25.12.5 (`r33051`).
- **NSS support:** taken from the `r7800-24.10.8` branch of
  [tingalvin/r7800](https://github.com/tingalvin/r7800), which was written for
  OpenWrt 24.10. That branch is the work of Lucas Asvio (asvio), SqTER-PL and
  reflector (tingalvin), and their commits keep their original authors here.
- **This repository** ports that work to 25.12, Linux 6.12 and backports 6.18,
  adds the C2600, and fixes what broke on the newer kernel.

The R7800 NSS builds go back several generations:

```
ACwifidude/openwrt       R7800 NSS for OpenWrt 22.03 / 23.05 (kernel 5.10–5.15)
 └─ asvio/R7800-nss       fork: r7800-23.05-nss … r7800-24.10-nss, r7800-k6.x-nss
     └─ tingalvin/r7800   OpenWrt 24.10.4 … 24.10.8
         └─ this repo     OpenWrt 25.12.5, Linux 6.12, + TP-Link Archer C2600
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
  no swconfig DTS, so it stays on DSA without NSS.
- **NSS packages:**
  - qca-nss-gmac, -drv, -clients, -ecm, -crypto, -cfi and qca-mcs were ported to
    6.12 (`.remove` returns void, `strscpy`, `no_llseek`, tracepoints, and so on);
  - since Linux 6.11, sysctl tables no longer end with a `{}` sentinel. Without
    this fix nss-gmac fails to probe and **no ethernet port comes up**.
- **WiFi stack:**
  - the mac80211 NSS redirect patch was refreshed for backports 6.18;
  - the ath10k-ct patches were retargeted to the `ath10k-6.18` tree;
  - the wifi-script tweaks were moved to the ucode scripts.
- **LuCI:** the VHT/QAM-256 on 2.4 GHz and NSS-load status patches are in
  `VHTNSS.zip`.
- **Branding:** images are named `openwrt-nss-…` and report
  `OpenWrt NSS 25.12.5`.

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
  When coming from an official 25.12 image, which uses DSA, use
  `sysupgrade -n`: the DSA network config does not work with swconfig.
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

### Not tested yet

- The 2.4 GHz radio.
- Long-term operation over several days.
- Repeated reboot cycles.
- The Netgear R7800 on real hardware.

## License

OpenWrt and the NSS packages keep their original licenses (see
[LICENSES](LICENSES) and the individual packages).
