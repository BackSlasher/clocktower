package catapultcoop

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGuideStartsAndSkips(t *testing.T) {
	g, ids := guided(t, 2)
	s := g.View()
	if s.Guide == nil || s.Guide.Step != 1 || s.Guide.Of != len(guideScript(2)) || !s.Untimed || g.Level() != 1 {
		t.Fatalf("guide %+v untimed %v level %d", s.Guide, s.Untimed, g.Level())
	}
	if len(s.Guide.Tasks) != 2 {
		t.Fatalf("tasks %+v", s.Guide.Tasks)
	}
	for _, tk := range s.Guide.Tasks {
		if tk.Text == "" || tk.Done || tk.Cell == nil || tk.Acts == nil || len(tk.Acts) > Defs.Slots {
			t.Fatalf("task %+v", tk)
		}
	}
	if len(s.Guide.Title) > 30 {
		t.Fatalf("title too long: %q", s.Guide.Title)
	}
	b, _ := json.Marshal(s)
	if !strings.Contains(string(b), `"guide":{"step":1,"of":8,`) {
		t.Fatalf("wire: %s", b)
	}
	wantCode(t, g.Apply(ids[1], Cmd{T: "skip_tutorial"}), "not_host")
	if err := g.Apply(ids[0], Cmd{T: "skip_tutorial"}); err != nil {
		t.Fatal(err)
	}
	s = g.View()
	if s.Guide != nil || g.Level() != 1 || !s.Untimed || len(g.script)+len(g.machines) == 0 {
		t.Fatalf("after skip: guide %+v untimed %v", s.Guide, s.Untimed)
	}
	b, _ = json.Marshal(s)
	if strings.Contains(string(b), `"guide"`) {
		t.Fatal("guide still on the wire")
	}
	wantCode(t, g.Apply(ids[0], Cmd{T: "skip_tutorial"}), "too_late")
}

// Every title fits the TV, for every team size.
func TestGuideScripts(t *testing.T) {
	for n := 1; n <= 4; n++ {
		st := guideScript(n)
		if st[len(st)-1].goals[1].k != gLive {
			t.Errorf("%d: no live step at the end", n)
		}
		for i, s := range st {
			if len(s.title) > 30 || s.text == "" || len(s.goals) != n {
				t.Errorf("%d players, step %d: %+v", n, i+1, s)
			}
		}
	}
}

// Following the suggested queues plays the whole guide; then level 1 starts
// with the wall whole and the stats cleared, and its turns have a timer.
func TestGuideFollowed(t *testing.T) {
	for n := 1; n <= 4; n++ {
		g, ids := guided(t, n)
		steps := map[int]bool{}
		for turn := 0; g.guide != nil; turn++ {
			if turn > 60 {
				t.Fatalf("%d players: stuck at step %d", n, g.guide.i+1)
			}
			s := g.View()
			steps[s.Guide.Step] = true
			for _, tk := range s.Guide.Tasks {
				if err := g.Apply(tk.PID, Cmd{T: "plan", Acts: tk.Acts, Done: true}); err != nil {
					t.Fatal(err)
				}
			}
			if g.Phase() != PhaseResolve {
				t.Fatalf("turn did not resolve: %s", g.phase)
			}
			leave(g, 30)
		}
		if !steps[len(guideScript(n))] || len(steps) < len(guideScript(n))-1 || g.Level() != 1 || g.Wall() != Defs.WallHP || g.Phase() != PhasePlan {
			t.Fatalf("%d players: steps %v level %d wall %d phase %s", n, steps, g.Level(), g.Wall(), g.phase)
		}
		if g.View().Untimed || g.left != PlanTime(1) {
			t.Fatalf("level 1 untimed=%v left=%v", g.View().Untimed, g.left)
		}
		for _, id := range ids {
			if g.player(id).st != (stats{}) {
				t.Fatal("tutorial stats kept")
			}
		}
	}
}

func TestPlanTimesAndStore(t *testing.T) {
	want := []float64{90, 70, 60, 50, 45, 40}
	for lv := 1; lv <= len(Defs.Levels); lv++ {
		if PlanTime(lv) != want[lv-1] || Defs.Levels[lv-1].PlanTime != want[lv-1] {
			t.Errorf("level %d plan time %v", lv, PlanTime(lv))
		}
	}
	g, _ := started(t, 1)
	b, _ := json.Marshal(g.RoomState())
	if !strings.Contains(string(b), `"store":[[`) {
		t.Fatalf("room layout lacks the store: %s", b)
	}
}
