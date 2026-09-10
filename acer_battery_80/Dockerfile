# Acer Battery 80% HAOS add-on
# Version: 0.2.0

FROM ghcr.io/home-assistant/base:3.24

ARG BUILD_VERSION="0.2.0"
ARG BUILD_ARCH="amd64"

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache kmod curl

COPY modules/6.18.39-haos/acer-wmi-battery.ko /opt/acer-wmi-battery/acer-wmi-battery.ko
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
