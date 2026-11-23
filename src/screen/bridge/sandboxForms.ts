export function installSandboxFormActions(document: Document): void {
  const submit = (event: Event, button: HTMLButtonElement) => {
    const form = button.form;
    if (!form || button.matches(":disabled")) return;
    event.preventDefault();
    if (!form.noValidate && !button.formNoValidate && !form.reportValidity()) return;
    form.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: button,
      }),
    );
  };

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (button instanceof HTMLButtonElement && button.type === "submit") submit(event, button);
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.isComposing ||
      !(event.target instanceof Element)
    ) {
      return;
    }
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
      return;
    }
    const form = event.target.closest("form");
    if (!form) return;
    const button = [...form.elements].find(
      (el): el is HTMLButtonElement => el instanceof HTMLButtonElement && el.type === "submit",
    );
    if (button) submit(event, button);
  });
}
