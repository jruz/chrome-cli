package version

import "fmt"

var (
	version   string
	revision  string
	buildTime string
)

type Info struct {
	Version   string
	Revision  string
	BuildTime string
}

func Current() Info {
	return Info{Version: version, Revision: revision, BuildTime: buildTime}
}

func (info Info) String() string {
	return fmt.Sprintf("%s (%s, %s)", info.Version, info.Revision, info.BuildTime)
}
