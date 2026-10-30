# SPDX-License-Identifier: GPL-2.0-only
#
# The NSS offload status page: Status -> NSS Offload renders
# 'nss-status -j', and Status -> Overview gets the NSS core load, the
# ECM-accelerated connections and the SoC temperatures.
#
# From luci-app-nss in kuncy7/openwrt-nss-edma (qualcommax), commit
# 755477b547ed. nss-tools here provides the same 'nss-status' interface for
# ipq806x; the page also shows the ipq806x keys of its JSON (switch ports,
# CRC/FCS errors, Wi-Fi redirect) and the diagnostics report.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI status page for NSS offloading
LUCI_DESCRIPTION:=Status -> NSS Offload: renders 'nss-status -j' (firmware state, \
 cores, ports, switch ports and link errors, ECM acceleration counts, SQM), runs \
 the 'nss-status -d' diagnostics report, and adds the NSS core load and the \
 ECM-accelerated connections to Status -> Overview.
LUCI_DEPENDS:=+luci-base +nss-tools
LUCI_PKGARCH:=all

PKG_LICENSE:=GPL-2.0-only

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
