using System;
using System.Collections.Generic;
using UnityEngine;

public interface ICartographerEngine
{
  event Action<IReadOnlyList<Star>, IReadOnlyList<TagNode>> OnNodesChanged;

  bool RequiresTick { get; }
  void Tick(float dt);

  float BoundRadius { get; }
  Vector3 Pivot { get; }

  MapLayoutMode EngineType { get; }
  int MaxActiveLines { get; }
  int MaxActiveLongLines { get; }
  ScapeCameraWarper ScapeWarper { get; }
  IReadOnlyList<Star> Stars { get; }
  IReadOnlyList<TagNode> TagNodes { get; }

  /// <summary>
  /// Builds into a state already cleared by Cartographer.
  /// </summary>
  void BuildGraph(List<NoteData> notes);

  /// <summary>
  /// Clears engine-owned visuals/state without publishing OnNodesChanged.
  /// </summary>
  void ClearGraph();

  void ApplyView(ScapeView view);

  ///  <summary>
  /// True position of the obgect for the camera (base, without visual warp).
  /// </summary>
  /// <param name="tr"></param>
  /// <param name="pos"></param>
  /// <returns></returns>  ///

  public bool TryGetNavigationWorld(Transform tr, out Vector3 pos)
  {
    pos = default;
    if (!tr) return false;

    if (ScapeWarper != null && ScapeWarper.TryGetBaseWorld(tr, out pos))
      return true;

    pos = tr.position;
    return true;
  }
}
