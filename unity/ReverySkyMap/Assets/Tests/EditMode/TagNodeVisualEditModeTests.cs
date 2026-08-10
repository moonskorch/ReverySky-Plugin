using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;

public class TagNodeVisualEditModeTests
{
  [TearDown]
  public void TearDown()
  {
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
  }

  [Test]
  public void Start_DisplaysOnlyFinalCompositeTagSegment()
  {
    const int tagId = 7;
    var root = new GameObject("TagNodeVisualEditModeTests_Root");
    try
    {
      var tagNode = root.AddComponent<TagNode>();
      tagNode.UserTagId = tagId;
      var visual = root.AddComponent<TagNodeVisual>();
      var tagText = new GameObject("TagNodeVisualEditModeTests_Text").AddComponent<TextMeshPro>();
      tagText.transform.SetParent(root.transform, false);

      SetPrivateField(visual, "tagNode", tagNode);
      SetPrivateField(visual, "tagText", tagText);
      MapRuntimeContext.SetTagNames(new Dictionary<int, string> { { tagId, "test/new/a2" } });

      visual.Start();

      Assert.That(MapRuntimeContext.GetTagName(tagId), Is.EqualTo("test/new/a2"));
      Assert.That(tagText.text, Is.EqualTo("a2"));
    }
    finally
    {
      Object.DestroyImmediate(root);
    }
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    field.SetValue(target, value);
  }
}
