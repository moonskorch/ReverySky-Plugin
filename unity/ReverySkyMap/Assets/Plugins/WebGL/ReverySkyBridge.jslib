mergeInto(LibraryManager.library, {
  ReverySkyBridgePostNoteOpen: function (noteIdPtr, notePathPtr) {
    var noteId = noteIdPtr ? UTF8ToString(noteIdPtr) : "";
    var notePath = notePathPtr ? UTF8ToString(notePathPtr) : "";

    if (typeof window !== "undefined" && typeof window.ReverySkyBridgePostNoteOpen === "function") {
      window.ReverySkyBridgePostNoteOpen(noteId, notePath);
      return;
    }

    if (typeof window !== "undefined" && window.parent && typeof window.parent.postMessage === "function") {
      window.parent.postMessage(
        {
          protocolVersion: "1.0.0",
          type: "note:open",
          requestId: "evt_" + Date.now(),
          payload: {
            id: noteId,
            path: notePath
          }
        },
        "*"
      );
    }
  }
});
