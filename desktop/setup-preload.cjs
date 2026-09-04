const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const progress = document.getElementById("progress");
  const track = progress.parentElement;
  const status = document.getElementById("status");
  const message = document.getElementById("setup-message");
  const form = document.getElementById("credential-form");
  const input = document.getElementById("api-key");
  const submit = document.getElementById("submit-key");
  const error = document.getElementById("setup-error");

  ipcRenderer.on("setup:status", (_event, state) => {
    const percent = Math.max(0, Math.min(100, Number(state?.percent) || 0));
    status.textContent = String(state?.text || "Preparando la aplicación…");
    progress.style.width = `${percent}%`;
    track.setAttribute("aria-valuenow", String(percent));
  });

  ipcRenderer.on("setup:request-api-key", (_event, details) => {
    message.textContent = String(details?.message || "Introduce tu clave API de OpenAI.");
    form.classList.add("visible");
    input.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    const result = await ipcRenderer.invoke("openai-key:submit", input.value);
    submit.disabled = false;

    if (!result?.ok) {
      error.textContent = result?.error || "No se pudo guardar la clave.";
      input.select();
      return;
    }

    if (result.warning) message.textContent = result.warning;
    form.classList.remove("visible");
  });
});
