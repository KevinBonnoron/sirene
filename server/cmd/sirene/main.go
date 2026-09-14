package main

import (
	"log"

	"github.com/KevinBonnoron/sirene/server/sirene"
)

func main() {
	if err := sirene.New(sirene.OptionsFromEnv()).Start(); err != nil {
		log.Fatal(err)
	}
}
