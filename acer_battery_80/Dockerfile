# Acer Battery 80% HAOS add-on
# Version: 0.1.0

FROM ghcr.io/home-assistant/base:3.24 AS builder

ARG KERNEL_VERSION="6.18.39"
ARG HAOS_VERSION="18.2"
ARG ACER_WMI_COMMIT="08d16e64a3db4a94717c5ed6c93d1b3857f96916"

RUN apk add --no-cache \
    bash \
    bc \
    bison \
    build-base \
    curl \
    elfutils-dev \
    flex \
    gzip \
    openssl-dev \
    perl \
    tar \
    xz

WORKDIR /build

RUN curl -fL --retry 3 \
      "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL_VERSION}.tar.xz" \
      -o linux.tar.xz \
    && tar -xJf linux.tar.xz \
    && rm linux.tar.xz

RUN mkdir -p /build/haos-config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/kernel/v6.18.y/haos.config" -o /build/haos-config/01-haos.config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/kernel/v6.18.y/docker.config" -o /build/haos-config/02-docker.config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/kernel/v6.18.y/device-support.config" -o /build/haos-config/03-device-support.config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/kernel/v6.18.y/device-support-wireless.config" -o /build/haos-config/04-device-support-wireless.config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/kernel/v6.18.y/device-support-wireless-pci.config" -o /build/haos-config/05-device-support-wireless-pci.config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/kernel/v6.18.y/device-support-pci.config" -o /build/haos-config/06-device-support-pci.config \
    && curl -fL --retry 3 "https://raw.githubusercontent.com/home-assistant/operating-system/${HAOS_VERSION}/buildroot-external/board/pc/generic-x86-64/kernel.config" -o /build/haos-config/07-generic-x86-64.config

RUN cd "/build/linux-${KERNEL_VERSION}" \
    && make x86_64_defconfig \
    && scripts/kconfig/merge_config.sh -m .config /build/haos-config/*.config \
    && make olddefconfig \
    && test "$(make -s kernelrelease)" = "${KERNEL_VERSION}-haos" \
    && if grep -q '^CONFIG_MODVERSIONS=y' .config; then \
         echo 'ERROR: CONFIG_MODVERSIONS=y; this build recipe requires a matching Module.symvers.' >&2; \
         exit 1; \
       fi \
    && make -j2 modules_prepare

RUN mkdir -p /build/acer-wmi-battery \
    && curl -fL --retry 3 \
      "https://raw.githubusercontent.com/frederik-h/acer-wmi-battery/${ACER_WMI_COMMIT}/acer-wmi-battery.c" \
      -o /build/acer-wmi-battery/acer-wmi-battery.c \
    && printf '%s\n' 'obj-m += acer-wmi-battery.o' > /build/acer-wmi-battery/Makefile \
    && make -C "/build/linux-${KERNEL_VERSION}" \
      M=/build/acer-wmi-battery \
      KBUILD_MODPOST_WARN=1 \
      modules \
    && test -s /build/acer-wmi-battery/acer-wmi-battery.ko

FROM ghcr.io/home-assistant/base:3.24

ARG BUILD_VERSION="0.1.0"
ARG BUILD_ARCH="amd64"

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache kmod

COPY --from=builder /build/acer-wmi-battery/acer-wmi-battery.ko /opt/acer-wmi-battery/acer-wmi-battery.ko
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
