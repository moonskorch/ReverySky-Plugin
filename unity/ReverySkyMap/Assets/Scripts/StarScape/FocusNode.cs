using System.Linq;
using UnityEngine;

public class FocusNode : MonoBehaviour
{
  [SerializeField] Transform layoutParent;
  [SerializeField] private CameraOrbitalController cameraController;
  [SerializeField] private float selectedDistance = 5.0f;

  private Star selectedStar;
  public string FocusRestoreNoteId;

  public Star SelectedStar => selectedStar;
  public CameraOrbitalController CameraController => cameraController;

  private void Start()
  {
    GameInput.Instance.OnSelect += HandleSelect;
  }

  private void HandleSelect(Vector2 screenPosition)
  {
    Ray ray = Camera.main.ScreenPointToRay(screenPosition);
    bool isHit = Physics.Raycast(
      ray,
      out RaycastHit hit,
      Camera.main.farClipPlane,
      GameInput.Instance.InteractableLayers);

    if (!isHit) return;

    Transform tappedObj = hit.transform;
    if (tappedObj.parent != layoutParent) return;

    if (tappedObj.TryGetComponent(out Star star))
    {
      SelectStar(star);
      FocusSelectedStar();
      MapRuntimeContext.RequestOpenNote(star.Data);
    }

    else if (tappedObj.TryGetComponent(out TagNode tagNode))
    {
      var nav = Cartographer.I.ActiveEngine;
      Vector3 tagPos =
        (nav != null && nav.TryGetNavigationWorld(tagNode.transform, out var p)) ? p
        : tagNode.transform.position;
      cameraController.SetActivePivot(tagNode.transform);
      cameraController.Focus(tagPos, selectedDistance);
    }
  }

  private void FocusSelectedStar()
  {
    var nav = Cartographer.I.ActiveEngine;
    Vector3 starPos =
      (nav != null && nav.TryGetNavigationWorld(selectedStar.transform, out var p)) ? p
      : selectedStar.transform.position;

    cameraController.SetActivePivot(selectedStar.transform);
    cameraController.Focus(starPos, selectedDistance);
  }

  public void SetSelectedStar(Star star)
  {
    SelectStar(star);
    FocusSelectedStar();
  }

  public void ResetFocus() 
  {
    selectedStar = null;
    cameraController.ResetToStart();
  }

  private void SelectStar(Star star)
  {
    selectedStar = star;
    FocusRestoreNoteId = star?.Data?.Id;
  }
}
