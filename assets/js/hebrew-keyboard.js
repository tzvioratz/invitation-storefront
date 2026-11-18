// Hebrew on-screen keyboard, identical in behavior to the one in editor.js.
// editor.js can import this later to remove its own copy.
export function createHebrewKeyboard(input, updateField) {
    const keyboard = document.createElement("div");
    keyboard.className = "hebrew-keyboard";
    keyboard.hidden = true;

    const rows = [
        ["ק", "ר", "א", "ט", "ו", "ן", "ם", "פ"],
        ["ש", "ד", "ג", "כ", "ע", "י", "ח", "ל", "ך", "ף"],
        ["ז", "ס", "ב", "ה", "נ", "מ", "צ", "ת", "ץ"],
        [".", ",", "?", "!", ":", ";", "'", "\"", "־", "׳", "״"]
    ];

    function insertText(text) {
        input.focus();

        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const newValue = input.value.slice(0, start) + text + input.value.slice(end);

        if (newValue.length > input.maxLength) return;

        input.setRangeText(text, start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        updateField();
    }

    rows.forEach(chars => {
        const row = document.createElement("div");
        row.className = "hebrew-keyboard-row";

        chars.forEach(char => {
            const key = document.createElement("button");
            key.type = "button";
            key.className = "hebrew-key";
            key.textContent = char;
            key.addEventListener("mousedown", e => e.preventDefault());
            key.addEventListener("click", () => insertText(char));
            row.appendChild(key);
        });

        keyboard.appendChild(row);
    });

    const specialRow = document.createElement("div");
    specialRow.className = "hebrew-keyboard-row special-keys";

    function addSpecialKey(text, className, action, title) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "hebrew-key " + className;
        key.textContent = text;
        key.title = title || text;
        key.addEventListener("mousedown", e => e.preventDefault());
        key.addEventListener("click", action);
        specialRow.appendChild(key);
    }

    addSpecialKey("Space", "space-key", () => insertText(" "), "Insert space");

    addSpecialKey("⌫", "backspace-key", () => {
        input.focus();

        let start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;

        if (start === end && start > 0) start--;

        input.setRangeText("", start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        updateField();
    }, "Backspace");

    addSpecialKey("↵ Enter", "enter-key", () => {
        insertText(input.tagName === "TEXTAREA" ? "\n" : " ");
    }, "Insert newline");

    keyboard.appendChild(specialRow);
    return keyboard;
}
