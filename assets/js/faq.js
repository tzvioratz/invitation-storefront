(() => {
  "use strict";

  const questions = Array.from(document.querySelectorAll(".faq-question"));

  // Accessible accordion: keep one answer open at a time.
  questions.forEach((button) => {
    button.addEventListener("click", () => {
      const wasExpanded = button.getAttribute("aria-expanded") === "true";

      questions.forEach((otherButton) => {
        otherButton.setAttribute("aria-expanded", "false");
        const answer = otherButton.closest(".faq-item")?.querySelector(".faq-answer");
        if (answer) answer.hidden = true;
      });

      if (!wasExpanded) {
        button.setAttribute("aria-expanded", "true");
        const answer = button.closest(".faq-item")?.querySelector(".faq-answer");
        if (answer) answer.hidden = false;
      }
    });
  });

  // Mobile navigation.
  const menuButton = document.querySelector(".faq-menu-toggle");
  const mobileNav = document.querySelector("#faq-mobile-nav");

  if (menuButton && mobileNav) {
    menuButton.addEventListener("click", () => {
      const isOpen = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
      mobileNav.hidden = isOpen;
    });

    mobileNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileNav.hidden = true;
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation");
      });
    });
  }

  // Highlight the topic link for the section currently being viewed.
  const topicLinks = Array.from(document.querySelectorAll(".faq-topic-link"));
  const groups = topicLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if ("IntersectionObserver" in window && groups.length) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;
      topicLinks.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`);
      });
    }, { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.15, 0.35] });

    groups.forEach((group) => observer.observe(group));
  }

  const year = document.querySelector("#faq-year");
  if (year) year.textContent = new Date().getFullYear();
})();
