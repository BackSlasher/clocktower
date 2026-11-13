package towerdefense

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

//go:embed brasswick.json
var brasswickJSON []byte

// Point is an [x, y] pair in map pixels.
type Point [2]float64

// MapPath is one street, a polyline from spawn to the clock tower.
type MapPath struct {
	Name string  `json:"name"`
	Pts  []Point `json:"pts"`

	cum []float64 // cumulative length at each point
	len float64
}

// Plot is a build site. Min is the smallest group the plot exists for (the
// plot tier, see Game.PlotsFor); 0 or 1 means always.
type Plot struct {
	ID  int     `json:"id"`
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Min int     `json:"min,omitempty"`
}

// PlotOpen reports whether plot exists at plot tier plotsFor (the room's
// `plotsFor`).
func PlotOpen(plot, plotsFor int) bool {
	return plot >= 0 && plot < len(Map.Plots) && Map.Plots[plot].Min <= max(1, plotsFor)
}

// XY is a point object.
type XY struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// MapT is the map as sent in `welcome`.
type MapT struct {
	Name  string     `json:"name"`
	W     float64    `json:"w"`
	H     float64    `json:"h"`
	Tower XY         `json:"tower"`
	Paths []*MapPath `json:"paths"`
	Plots []Plot     `json:"plots"`
}

// Map is the one map, Brasswick.
var Map = mustLoadMap(brasswickJSON)

func mustLoadMap(b []byte) *MapT {
	var m MapT
	if err := json.Unmarshal(b, &m); err != nil {
		panic(fmt.Sprintf("game: bad map: %v", err))
	}
	for i, pl := range m.Plots {
		if pl.ID != i {
			panic("game: plot ids must be 0..n-1 in order")
		}
	}
	for _, p := range m.Paths {
		p.init()
	}
	return &m
}

func (p *MapPath) init() {
	p.cum = make([]float64, len(p.Pts))
	for i := 1; i < len(p.Pts); i++ {
		p.cum[i] = p.cum[i-1] + dist(p.Pts[i-1][0], p.Pts[i-1][1], p.Pts[i][0], p.Pts[i][1])
	}
	p.len = p.cum[len(p.cum)-1]
}

// Len is the path length in map pixels.
func (p *MapPath) Len() float64 { return p.len }

// PosAt returns the position d pixels along the path (clamped).
func (p *MapPath) PosAt(d float64) (x, y float64) {
	if d <= 0 {
		return p.Pts[0][0], p.Pts[0][1]
	}
	for i := 1; i < len(p.Pts); i++ {
		if d <= p.cum[i] {
			seg := p.cum[i] - p.cum[i-1]
			t := 0.0
			if seg > 0 {
				t = (d - p.cum[i-1]) / seg
			}
			a, b := p.Pts[i-1], p.Pts[i]
			return a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t
		}
	}
	last := p.Pts[len(p.Pts)-1]
	return last[0], last[1]
}

// DistToPoint returns the shortest distance from (x, y) to the polyline.
func (p *MapPath) DistToPoint(x, y float64) float64 {
	best := math.Inf(1)
	for i := 1; i < len(p.Pts); i++ {
		best = math.Min(best, segDist(x, y, p.Pts[i-1], p.Pts[i]))
	}
	return best
}

// CoverLen approximates how much of the on-screen path lies within r of (x, y).
func (p *MapPath) CoverLen(x, y, r, w, h float64) float64 {
	const step = 5.0
	total := 0.0
	for d := 0.0; d < p.len; d += step {
		px, py := p.PosAt(d)
		if px < 0 || py < 0 || px > w || py > h {
			continue
		}
		if dist(px, py, x, y) <= r {
			total += step
		}
	}
	return total
}

func segDist(x, y float64, a, b Point) float64 {
	dx, dy := b[0]-a[0], b[1]-a[1]
	l2 := dx*dx + dy*dy
	t := 0.0
	if l2 > 0 {
		t = math.Max(0, math.Min(1, ((x-a[0])*dx+(y-a[1])*dy)/l2))
	}
	return dist(x, y, a[0]+t*dx, a[1]+t*dy)
}

func dist(x1, y1, x2, y2 float64) float64 { return math.Hypot(x2-x1, y2-y1) }
