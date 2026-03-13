//! Shared application state

use dashmap::DashMap;
use ruvector_core::{DistanceMetric, VectorDB};
use std::sync::Arc;

/// Collection metadata stored alongside the VectorDB
#[derive(Clone)]
pub struct CollectionEntry {
    pub db: Arc<VectorDB>,
    pub dimension: usize,
    pub metric: DistanceMetric,
}

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    /// Map of collection name to CollectionEntry
    pub collections: Arc<DashMap<String, CollectionEntry>>,
}

impl AppState {
    /// Create a new application state
    pub fn new() -> Self {
        Self {
            collections: Arc::new(DashMap::new()),
        }
    }

    /// Get a collection by name
    pub fn get_collection(&self, name: &str) -> Option<Arc<VectorDB>> {
        self.collections.get(name).map(|c| c.db.clone())
    }

    /// Get collection entry with metadata
    pub fn get_collection_entry(&self, name: &str) -> Option<CollectionEntry> {
        self.collections.get(name).map(|c| c.clone())
    }

    /// Insert a collection with metadata
    pub fn insert_collection(&self, name: String, db: Arc<VectorDB>, dimension: usize, metric: DistanceMetric) {
        self.collections.insert(name, CollectionEntry { db, dimension, metric });
    }

    /// Remove a collection
    pub fn remove_collection(&self, name: &str) -> Option<CollectionEntry> {
        self.collections.remove(name).map(|(_, c)| c)
    }

    /// Check if a collection exists
    pub fn contains_collection(&self, name: &str) -> bool {
        self.collections.contains_key(name)
    }

    /// Get all collection names
    pub fn collection_names(&self) -> Vec<String> {
        self.collections
            .iter()
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// Get the number of collections
    pub fn collection_count(&self) -> usize {
        self.collections.len()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
