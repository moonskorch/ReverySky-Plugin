using UnityEngine;

public class Star : MonoBehaviour
{
  [SerializeField] private StarSO starSO;

  /// <summary>
  /// Link to runtime note data.
  /// </summary>
  public NoteData Data { get; private set; } = new NoteData();

  public void SetData(NoteData data)
  {
    Data = data;
  }
}
