package main

import (
    "fmt"
    "github.com/gin-gonic/gin"
    "./imported"
)

type Config struct {
    Port int
}

type Database interface {
    Connect() error
}

type ID string

func HelloWorld() {
    fmt.Println("Hello, World!")
}
