(function () {
  var highlights = ["yellow", "pink", "blue", "green"];
  try {
    var params = new URLSearchParams(window.location.search);
    var theme = params.get("theme");
    if (theme !== "day" && theme !== "night") {
      theme = window.localStorage.getItem("cad-mockup-theme");
    }
    document.documentElement.setAttribute(
      "data-theme",
      theme === "night" ? "night" : "day",
    );

    var highlight = params.get("highlight");
    if (highlights.indexOf(highlight) === -1) {
      highlight = window.localStorage.getItem("cad-mockup-highlight");
    }
    document.documentElement.setAttribute(
      "data-highlight",
      highlights.indexOf(highlight) === -1 ? "yellow" : highlight,
    );
  } catch (error) {
    document.documentElement.setAttribute("data-theme", "day");
    document.documentElement.setAttribute("data-highlight", "yellow");
  }
})();
