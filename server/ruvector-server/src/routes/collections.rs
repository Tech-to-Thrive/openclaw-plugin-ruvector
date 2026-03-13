//! Collection management endpoints

use crate::{error::Error, state::AppState, Result};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use ruvector_core::{types::DbOptions, DistanceMetric, VectorDB};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Collection creation request
#[derive(Debug, Deserialize)]
pub struct CreateCollectionRequest {
    /// Collection name
    pub name: String,
    /// Vector dimension
    pub dimension: usize,
    /// Distance metric (optional, defaults to Cosine)
    pub metric: Option<DistanceMetric>,
}

/// Collection info response
#[derive(Debug, Serialize)]
pub struct CollectionInfo {
    /// Collection name
    pub name: String,
    /// Vector dimension
    pub dimension: usize,
    /// Distance metric
    pub metric: DistanceMetric,
    /// Number of points
    pub count: usize,
}

/// List of collections response
#[derive(Debug, Serialize)]
pub struct CollectionsList {
    /// Collection names
    pub collections: Vec<String>,
}

/// Create collection routes
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(create_collection).get(list_collections))
        .route("/:name", get(get_collection).delete(delete_collection))
}

/// Create a new collection
///
/// POST /collections
async fn create_collection(
    State(state): State<AppState>,
    Json(req): Json<CreateCollectionRequest>,
) -> Result<impl IntoResponse> {
    if state.contains_collection(&req.name) {
        return Err(Error::CollectionExists(req.name));
    }

    let metric = req.metric.unwrap_or(DistanceMetric::Cosine);
    let mut options = DbOptions::default();
    options.dimensions = req.dimension;
    options.distance_metric = metric;
    options.storage_path = format!("memory://{}", req.name);

    let db = VectorDB::new(options).map_err(Error::Core)?;
    state.insert_collection(req.name.clone(), Arc::new(db), req.dimension, metric);

    let info = CollectionInfo {
        name: req.name,
        dimension: req.dimension,
        metric,
        count: 0,
    };

    Ok((StatusCode::CREATED, Json(info)))
}

/// List all collections
///
/// GET /collections
async fn list_collections(State(state): State<AppState>) -> Result<impl IntoResponse> {
    let collections = state.collection_names();
    Ok(Json(CollectionsList { collections }))
}

/// Get collection information
///
/// GET /collections/:name
async fn get_collection(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse> {
    let entry = state
        .get_collection_entry(&name)
        .ok_or_else(|| Error::CollectionNotFound(name.clone()))?;

    let count = entry.db.len().unwrap_or(0);

    let info = CollectionInfo {
        name,
        dimension: entry.dimension,
        metric: entry.metric,
        count,
    };

    Ok(Json(info))
}

/// Delete a collection
///
/// DELETE /collections/:name
async fn delete_collection(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse> {
    state
        .remove_collection(&name)
        .ok_or_else(|| Error::CollectionNotFound(name))?;

    Ok(StatusCode::NO_CONTENT)
}
