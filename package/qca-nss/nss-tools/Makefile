include $(TOPDIR)/rules.mk

PKG_NAME:=nss-tools
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/nss-tools
  SECTION:=net
  CATEGORY:=Base system
  TITLE:=NSS offload status report (nss-status)
  DEPENDS:=@TARGET_ipq806x +ethtool
  PKGARCH:=all
endef

define Package/nss-tools/description
  nss-status reports the health of the NSS data plane on ipq806x: firmware
  state, NSS core load, the offloaded share per GMAC, the switch ports, CRC
  and FCS errors, ECM, the Wi-Fi redirect and the NSS SQM shaper. It has the
  interface of nss-status from nss-tools on qualcommax (-j, -d, -l2), so
  luci-app-nss reads it.
endef

define Build/Compile
endef

define Package/nss-tools/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/nss-status $(1)/usr/sbin/
endef

$(eval $(call BuildPackage,nss-tools))
