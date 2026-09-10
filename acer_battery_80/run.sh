#!/usr/bin/with-contenv bashio
# Acer Battery 80% HAOS add-on
# Version: 0.1.1
set -Eeuo pipefail

ADDON_VERSION="0.1.1"
EXPECTED_KERNEL="6.18.39-haos"
GUID="79772EC5-04B1-4BFD-843C-61E7F77B6CC9"
MODULE="/opt/acer-wmi-battery/acer-wmi-battery.ko"
SYSFS_DRIVER="/sys/bus/wmi/drivers/acer-wmi-battery"
HEALTH_MODE_FILE="${SYSFS_DRIVER}/health_mode"

bashio::log.info "Acer Battery 80% v${ADDON_VERSION}"
bashio::log.info "Running kernel: $(uname -r)"

if [[ "$(uname -m)" != "x86_64" ]]; then
    bashio::log.fatal "This build supports x86_64 only."
    exit 1
fi

if [[ "$(uname -r)" != "${EXPECTED_KERNEL}" ]]; then
    bashio::log.fatal "Kernel mismatch. Expected ${EXPECTED_KERNEL}, got $(uname -r)."
    bashio::log.fatal "Do not force-load this module. Build a version for the current HAOS kernel."
    exit 1
fi

if bashio::config.true 'health_mode'; then
    DESIRED="1"
    LABEL="ENABLED"
else
    DESIRED="0"
    LABEL="DISABLED"
fi

if ! ls /sys/bus/wmi/devices/ 2>/dev/null | grep -qi "^${GUID}"; then
    bashio::log.fatal "Acer battery-health WMI GUID ${GUID} was not found."
    exit 1
fi
bashio::log.info "Acer battery-health WMI GUID found."

if [[ ! -f "${MODULE}" ]]; then
    bashio::log.fatal "Kernel module is missing from the add-on image: ${MODULE}"
    exit 1
fi

VERMAGIC="$(modinfo -F vermagic "${MODULE}" 2>/dev/null || true)"
bashio::log.info "Module vermagic: ${VERMAGIC:-unknown}"
if [[ -z "${VERMAGIC}" || "${VERMAGIC%% *}" != "${EXPECTED_KERNEL}" ]]; then
    bashio::log.fatal "Module vermagic does not match ${EXPECTED_KERNEL}."
    exit 1
fi

if grep -q '^acer_wmi_battery ' /proc/modules 2>/dev/null; then
    bashio::log.info "acer_wmi_battery is already loaded."
else
    bashio::log.info "Loading acer-wmi-battery with enable_health_mode=${DESIRED}..."
    if ! insmod "${MODULE}" enable_health_mode="${DESIRED}"; then
        bashio::log.fatal "insmod failed. Check the Host log/dmesg for acer_wmi_battery messages."
        exit 1
    fi
fi

for _ in 1 2 3 4 5; do
    [[ -e "${HEALTH_MODE_FILE}" ]] && break
    sleep 1
done

if [[ ! -e "${HEALTH_MODE_FILE}" ]]; then
    bashio::log.fatal "Driver loaded, but ${HEALTH_MODE_FILE} does not exist."
    exit 1
fi

CURRENT="$(cat "${HEALTH_MODE_FILE}")"
bashio::log.info "Current health_mode: ${CURRENT}"

if [[ "${CURRENT}" == "-1" ]]; then
    bashio::log.fatal "The WMI GUID exists, but this firmware reports health mode as unsupported."
    exit 1
fi

if [[ "${CURRENT}" != "${DESIRED}" ]]; then
    bashio::log.info "Module was already loaded or firmware did not apply the requested state; setting health_mode=${DESIRED}..."
    if ! printf '%s\n' "${DESIRED}" > "${HEALTH_MODE_FILE}"; then
        bashio::log.fatal "Could not write ${HEALTH_MODE_FILE}. Stop/unload the module and start the add-on again to apply via module parameter."
        exit 1
    fi
fi

AFTER="$(cat "${HEALTH_MODE_FILE}")"
if [[ "${AFTER}" != "${DESIRED}" ]]; then
    bashio::log.fatal "Health-mode verification failed. Requested ${DESIRED}, read back ${AFTER}."
    exit 1
fi

bashio::log.info "Health mode verified: ${AFTER}"

if [[ -r /sys/class/power_supply/BAT0/capacity ]]; then
    CAPACITY="$(cat /sys/class/power_supply/BAT0/capacity)"
    STATUS="$(cat /sys/class/power_supply/BAT0/status 2>/dev/null || echo unknown)"
    bashio::log.info "Battery capacity: ${CAPACITY}% (${STATUS})"
fi

if [[ "${DESIRED}" == "1" ]]; then
    bashio::log.info "Acer ~80% battery charge limit is ${LABEL}."
else
    bashio::log.info "Acer battery health-mode charge limit is ${LABEL}."
fi
