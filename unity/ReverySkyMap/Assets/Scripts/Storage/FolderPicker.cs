using SimpleFileBrowser;
using UnityEngine;

public class FolderPicker : MonoBehaviour
{
  public void PickFolder(FileBrowser.OnSuccess onSuccess, string initialPath = null)
  {
    FileBrowser.ShowLoadDialog(
        onSuccess: onSuccess,
        onCancel: () => { },
        pickMode: FileBrowser.PickMode.Folders,
        allowMultiSelection: false,
        initialPath: initialPath,
        initialFilename: null,
        title: GameSettings.FolderPickCommandTitle,
        loadButtonText: GameSettings.CommonSelectCaption
    );
  }
}
