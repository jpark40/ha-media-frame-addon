#!/usr/bin/with-contenv bashio
# Acer Battery 80% HAOS add-on
# Version: 0.1.3
set -Eeuo pipefail

ADDON_VERSION="0.1.3"
EXPECTED_KERNEL="6.18.39-haos"
GUID="79772EC5-04B1-4BFD-843C-61E7F77B6CC9"
MODULE="/opt/acer-wmi-battery/acer-wmi-battery.ko"
SYSFS_DRIVER="/sys/bus/wmi/drivers/acer-wmi-battery"
HEALTH_MODE_FILE="${SYSFS_DRIVER}/health_mode"

show_kernel_diag() {
    local out
    out="$(dmesg 2>/dev/null | grep -Ei 'acer_wmi_battery|acer-wmi-battery|acer_wmi|wmi|acpi.*(error|fail)' | tail -80 || true)"
    if [[ -n "${out}" ]]; then
        bashio::log.info "Recent Acer/WMI kernel messages:"
        printf '%s\n' "${out}"
    else
        bashio::log.warning "Kernel messages are not readable from this add-on. If needed, run this from the HAOS host shell:"
        bashio::log.warning "dmesg | grep -Ei 'acer_wmi_battery|acer-wmi-battery|wmi|acpi.*(error|fail)' | tail -80"
    fi
}

show_battery() {
    if [[ -r /sys/class/power_supply/BAT0/capacity ]]; then
        local capacity status
        capacity="$(cat /sys/class/power_supply/BAT0/capacity)"
        status="$(cat /sys/class/power_supply/BAT0/status 2>/dev/null || echo unknown)"
        bashio::log.info "Battery capacity: ${capacity}% (${status})"
    fi
}

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

if ! modinfo -p "${MODULE}" 2>/dev/null | grep -q '^set_only:'; then
    bashio::log.fatal "This image contains an old kernel module without the set_only compatibility fallback."
    exit 1
fi

# If a previous set-only run left the module resident there is intentionally no
# sysfs interface. Unload it so the requested state can be applied again.
if grep -q '^acer_wmi_battery ' /proc/modules 2>/dev/null && [[ ! -e "${HEALTH_MODE_FILE}" ]]; then
    bashio::log.info "Removing previous set-only acer_wmi_battery instance..."
    rmmod acer_wmi_battery || true
fi

# If the fully registered driver is already present, use its sysfs control.
if grep -q '^acer_wmi_battery ' /proc/modules 2>/dev/null && [[ -e "${HEALTH_MODE_FILE}" ]]; then
    CURRENT="$(cat "${HEALTH_MODE_FILE}" 2>/dev/null || echo unknown)"
    bashio::log.info "Driver already loaded; current health_mode: ${CURRENT}"
    if [[ "${CURRENT}" != "${DESIRED}" ]]; then
        bashio::log.info "Setting health_mode=${DESIRED} through sysfs..."
        printf '%s\n' "${DESIRED}" > "${HEALTH_MODE_FILE}"
    fi
    AFTER="$(cat "${HEALTH_MODE_FILE}" 2>/dev/null || echo unknown)"
    if [[ "${AFTER}" != "${DESIRED}" ]]; then
        bashio::log.fatal "Health-mode verification failed. Requested ${DESIRED}, read back ${AFTER}."
        exit 1
    fi
    bashio::log.info "Health mode verified: ${AFTER}"
    show_battery
    bashio::log.info "Acer ~80% battery charge limit is ${LABEL}."
    exit 0
fi

# First try the upstream behavior: SET health mode, query status, register the
# WMI driver, and expose health_mode through sysfs.
bashio::log.info "Trying normal Acer WMI mode with enable_health_mode=${DESIRED}..."
set +e
insmod "${MODULE}" enable_health_mode="${DESIRED}"
NORMAL_RC=$?
set -e

if [[ ${NORMAL_RC} -eq 0 ]]; then
    for _ in 1 2 3 4 5; do
        [[ -e "${HEALTH_MODE_FILE}" ]] && break
        sleep 1
    done

    if [[ -e "${HEALTH_MODE_FILE}" ]]; then
        AFTER="$(cat "${HEALTH_MODE_FILE}" 2>/dev/null || echo unknown)"
        bashio::log.info "Current health_mode: ${AFTER}"
        if [[ "${AFTER}" != "${DESIRED}" ]]; then
            bashio::log.info "Setting health_mode=${DESIRED} through sysfs..."
            printf '%s\n' "${DESIRED}" > "${HEALTH_MODE_FILE}"
            AFTER="$(cat "${HEALTH_MODE_FILE}" 2>/dev/null || echo unknown)"
        fi
        if [[ "${AFTER}" != "${DESIRED}" ]]; then
            bashio::log.fatal "Health-mode verification failed. Requested ${DESIRED}, read back ${AFTER}."
            exit 1
        fi
        bashio::log.info "Health mode verified: ${AFTER}"
        show_battery
        bashio::log.info "Acer ~80% battery charge limit is ${LABEL}."
        exit 0
    fi

    bashio::log.warning "Module loaded normally but no health_mode sysfs file appeared."
    show_kernel_diag
    exit 1
fi

bashio::log.warning "Normal mode returned I/O error (rc=${NORMAL_RC})."
show_kernel_diag

# Older Acer firmware can expose the correct battery-health GUID and accept
# method 21 (SET) while method 20 (GET status) uses an incompatible response.
# The patched module's set_only=1 path treats a successful SET as success and
# deliberately skips the GET/status registration that caused the old add-on to
# return I/O error.
bashio::log.info "Trying older-firmware compatibility mode (set_only=1)..."
set +e
insmod "${MODULE}" enable_health_mode="${DESIRED}" set_only=1
SET_RC=$?
set -e

if [[ ${SET_RC} -ne 0 ]]; then
    bashio::log.error "Compatibility SET failed (rc=${SET_RC})."
    show_kernel_diag
    bashio::log.fatal "The WMI GUID exists, but firmware did not accept the battery health-mode SET request."
    exit 1
fi

bashio::log.info "Firmware accepted the health-mode SET request in compatibility mode."
bashio::log.warning "This older-firmware path cannot read the setting back through method 20, so software verification is unavailable."
show_battery
if [[ "${DESIRED}" == "1" ]]; then
    bashio::log.info "Requested Acer ~80% battery health mode: ${LABEL}."
    bashio::log.info "Verify behavior by discharging below 80%, reconnecting AC, and confirming charging stops around 80%."
else
    bashio::log.info "Requested Acer battery health mode: ${LABEL}."
fi
