(function () {
  "use strict";

  const form = document.getElementById("settings-form");
  const formStatus = document.getElementById("form-status");
  const weatherToggle = document.getElementById("show-weather");
  const weatherField = document.getElementById("weather-field");
  const weatherSelect = document.getElementById("weather-entity");
  const weatherHelp = document.getElementById("weather-help");
  const releaseVersion = "1.2.5";

  function screensaverPlaylist(fit) {
    const playlist = JSON.stringify([{
      type: 0,
      url: `${window.location.origin}/?fit=${fit}&v=${releaseVersion}`,
      loopItem: false,
      loopFile: false,
      fileOrder: 0,
      nextItemOnTouch: false,
      nextFileOnTouch: false,
      nextItemTimer: 0,
      nextFileTimer: 0,
    }], null, 2);
    return playlist.replace(/\//g, "\\/");
  }

  async function json(url, options) {
    const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function status(message, type) {
    formStatus.textContent = message || "";
    formStatus.className = type || "";
  }

  function updateWeatherState() {
    weatherField.classList.toggle("disabled", !weatherToggle.checked);
    weatherSelect.disabled = !weatherToggle.checked;
  }

  function setForm(settings) {
    Object.entries(settings).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value;
    });
    updateWeatherState();
  }

  function collectForm() {
    return {
      media_path: form.elements.media_path.value.trim(),
      photo_seconds: Number(form.elements.photo_seconds.value),
      video_seconds: Number(form.elements.video_seconds.value),
      video_repeats: Number(form.elements.video_repeats.value),
      fit: form.elements.fit.value,
      transition_seconds: Number(form.elements.transition_seconds.value),
      scan_seconds: Number(form.elements.scan_seconds.value),
      shuffle: form.elements.shuffle.checked,
      show_clock: form.elements.show_clock.checked,
      show_weather: form.elements.show_weather.checked,
      weather_entity: form.elements.weather_entity.value,
    };
  }

  async function load() {
    document.getElementById("contain-playlist-json").value = screensaverPlaylist("contain");
    document.getElementById("cover-playlist-json").value = screensaverPlaylist("cover");
    try {
      const [configResult, folderResult, weatherResult] = await Promise.all([
        json("/api/config"),
        json("/api/folders"),
        json("/api/weather/entities"),
      ]);

      const datalist = document.getElementById("media-folders");
      (folderResult.folders || []).forEach((folder) => {
        const option = document.createElement("option");
        option.value = folder;
        datalist.appendChild(option);
      });

      (weatherResult.entities || []).forEach((entity) => {
        const option = document.createElement("option");
        option.value = entity.entity_id;
        option.textContent = `${entity.name} · ${entity.entity_id}`;
        weatherSelect.appendChild(option);
      });
      if (weatherResult.error) weatherHelp.textContent = `Weather entities unavailable: ${weatherResult.error}`;
      setForm(configResult.settings);
      status("Settings loaded.");
    } catch (error) {
      status(error.message || "Unable to load settings.", "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    status("Saving…");
    try {
      const result = await json("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectForm()),
      });
      setForm(result.settings);
      status("Saved. An open screen will update within a few seconds.", "success");
    } catch (error) {
      status(error.message || "Unable to save settings.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  weatherToggle.addEventListener("change", updateWeatherState);

  document.getElementById("rescan").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    status("Scanning media folders…");
    try {
      const result = await json("/api/rescan", { method: "POST" });
      if (result.error) status(`${result.count} files found. ${result.error}`, "error");
      else status(`${result.count} photos and videos found.`, "success");
    } catch (error) {
      status(error.message || "Rescan failed.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll(".copy-value").forEach((button) => {
    button.addEventListener("click", async () => {
      const input = document.getElementById(button.dataset.copyTarget);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      status("Copied to clipboard.", "success");
    });
  });

  load();
}());
