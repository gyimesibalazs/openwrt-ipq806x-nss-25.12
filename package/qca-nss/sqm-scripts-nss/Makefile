include $(TOPDIR)/rules.mk

PKG_NAME:=sqm-scripts-nss
PKG_SOURCE_DATE:=2023-03-20
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/rickkdotnet/sqm-scripts-nss.git
PKG_SOURCE_VERSION:=bf905d85137817b49f619a3b2544c2e6f70dd22d
PKG_MIRROR_HASH:=93328d665584726bf8cb963428417722c54fcc94858de7450ab69181a2e39188

PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/sqm-scripts-nss
  SECTION:=net
  CATEGORY:=Base system
  TITLE:=SQM script for the NSS qdiscs (nss-rk.qos)
  URL:=https://github.com/rickkdotnet/sqm-scripts-nss
  DEPENDS:=@TARGET_ipq806x +sqm-scripts +ip6tables-nft +kmod-qca-nss-drv-qdisc +kmod-nss-ifb
  PKGARCH:=all
endef

define Package/sqm-scripts-nss/description
  An SQM queue setup script that shapes with the NSS accelerated nsstbl
  and nssfq_codel qdiscs, so the traffic stays on the NSS cores. Select
  fq_codel and nss-rk.qos in the SQM configuration, on the eth interface
  that carries the WAN traffic.
endef

define Build/Compile
endef

define Package/sqm-scripts-nss/install
	$(INSTALL_DIR) $(1)/usr/lib/sqm
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/files/usr/lib/sqm/nss-rk.qos \
		$(PKG_BUILD_DIR)/files/usr/lib/sqm/nss-rk.qos.help \
		$(1)/usr/lib/sqm/
endef

$(eval $(call BuildPackage,sqm-scripts-nss))
