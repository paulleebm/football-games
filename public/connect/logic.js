(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONNECTION_FIELDS = [
    { key: "team", suffix: "" },
    { key: "birthYear", suffix: "년생" },
    { key: "position", suffix: "" },
    { key: "nationality", suffix: " 국적" },
    { key: "shirtNumber", suffix: "번" },
  ];

  function getConnections(players) {
    if (!Array.isArray(players) || players.length !== 4) return [];
    return CONNECTION_FIELDS.flatMap(({ key, suffix }) => {
      if (key === "position") {
        const firstPositions = players[0]?.positions || [players[0]?.position].filter(Boolean);
        const shared = firstPositions.filter((position) => players.slice(1).every((player) => {
          const positions = player?.positions || [player?.position].filter(Boolean);
          return positions.includes(position);
        }));
        return shared.map((value) => ({ key, value, label: value }));
      }
      const value = players[0]?.[key];
      if (value === undefined || value === null || value === "") return [];
      return players.every((player) => player?.[key] === value)
        ? [{ key, value, label: `${value}${suffix}` }]
        : [];
    });
  }

  return { CONNECTION_FIELDS, getConnections };
});
