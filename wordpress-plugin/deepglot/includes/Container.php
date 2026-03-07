<?php

namespace Deepglot;

use InvalidArgumentException;
use RuntimeException;

class Container
{
    /** @var array<string, callable> */
    private array $factories = [];

    /** @var array<string, object> */
    private array $instances = [];

    public function singleton(string $id, callable $factory): void
    {
        $this->factories[$id] = $factory;
    }

    public function get(string $id): object
    {
        if (isset($this->instances[$id])) {
            return $this->instances[$id];
        }

        if (!isset($this->factories[$id])) {
            throw new InvalidArgumentException(sprintf('Service "%s" is not registered.', $id));
        }

        $service = ($this->factories[$id])($this);

        if (!is_object($service)) {
            throw new RuntimeException(sprintf('Factory for "%s" must return an object.', $id));
        }

        $this->instances[$id] = $service;

        return $service;
    }
}
