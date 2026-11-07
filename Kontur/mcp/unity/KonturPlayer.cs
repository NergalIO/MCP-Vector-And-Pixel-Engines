// Kontur → Unity: сцена, экспортированная из Kontur (export format "unity").
// Клипы сцены — состояния Animator (переходы «потом» уже настроены в контроллере),
// состояния объектов (дверь открыта/закрыта) — дочерние объекты, которые включаются по группе и варианту.
using System;
using System.Collections.Generic;
using UnityEngine;

[DisallowMultipleComponent]
[AddComponentMenu("Kontur/Kontur Player")]
public class KonturPlayer : MonoBehaviour
{
    [Serializable]
    public class StateObject
    {
        public string group;
        public string value;
        public GameObject target;
    }

    [Tooltip("Клипы сцены (состояния Animator)")]
    public string[] clips = new string[0];

    [Tooltip("Группы состояний: вариант по умолчанию")]
    public List<string> stateDefaults = new List<string>();

    [Tooltip("Объекты, которые видны только в своём варианте состояния")]
    public List<StateObject> stateObjects = new List<StateObject>();

    Dictionary<string, string> current;
    Animator animator;

    // всё берётся при первом обращении: Play/SetState можно звать и из Awake других скриптов
    Animator Anim
    {
        get
        {
            if (animator == null) animator = GetComponent<Animator>();
            return animator != null && animator.runtimeAnimatorController != null ? animator : null;
        }
    }
    Dictionary<string, string> Current
    {
        get
        {
            if (current != null) return current;
            current = new Dictionary<string, string>();
            foreach (var d in stateDefaults)
            {
                var i = d.IndexOf('=');
                if (i > 0) current[d.Substring(0, i)] = d.Substring(i + 1);
            }
            return current;
        }
    }

    /// <summary>Включить клип с начала (имя клипа из Kontur).</summary>
    public void Play(string clip)
    {
        Anim?.Play(clip, 0, 0f);
    }

    /// <summary>Имя клипа, который играет сейчас (или null).</summary>
    public string CurrentClip
    {
        get
        {
            var a = Anim;
            if (a == null) return null;
            var info = a.GetCurrentAnimatorStateInfo(0);
            foreach (var c in clips) if (info.IsName(c)) return c;
            return null;
        }
    }

    /// <summary>Показать вариант группы состояний: SetState("locker", "open").</summary>
    public void SetState(string group, string value)
    {
        Current[group] = value;
        foreach (var s in stateObjects)
            if (s.group == group && s.target != null) s.target.SetActive(s.value == value);
    }

    /// <summary>Текущий вариант группы (или null).</summary>
    public string GetState(string group) => Current.TryGetValue(group, out var v) ? v : null;
}
