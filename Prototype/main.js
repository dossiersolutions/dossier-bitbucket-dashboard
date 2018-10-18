const stepStatePriorities = {
	IN_PROGRESS: 0,
	SUCCESSFUL: 0,
	FAILED: 1,
	ERROR: 1
};

const stateUpdateInterval = 15000;
const pipelineCount = 100;

function sendAPIRequest(method, path, body = null) {
	const promise = new Promise((resolve, reject) => {
		const authToken = window.sessionStorage.getItem("authToken");
		const request = new XMLHttpRequest();
		
		request.onreadystatechange = () => {
			if (request.readyState === 4) {
				try {
					const result = JSON.parse(request.responseText);
					(request.status === 200) ? resolve(result) : reject(result);
				}
				catch (error) {
					reject(request);
				}
			}
		};
		
		request.open(method, "https://api.bitbucket.org/2.0/" + path);
		request.setRequestHeader("Authorization", "Basic " + authToken);
		request.send(body);
	});
	
	return promise;
}

function updateState() {
	const state = {
		branches: {}
	};
	
	return new Promise((resolve, reject) => {
		sendAPIRequest("GET", "repositories/dossiersolutions/dossier-profile/pipelines/")
			.then((result) => {
				let processedPipelines = 0;
				
				for (let pipelineIndex = result.size; pipelineIndex > result.size - pipelineCount; pipelineIndex--) {
					sendAPIRequest("GET", "repositories/dossiersolutions/dossier-profile/pipelines/" + pipelineIndex)
						.then((result) => {
							if (!state.branches[result.target.ref_name]) {
								state.branches[result.target.ref_name] = {
									name: result.target.ref_name,
									aggregatedSteps: {}
								};
							}
							
							const branch = state.branches[result.target.ref_name];
							
							if (!branch.lastPipeline || branch.lastPipeline < result.build_number) {
								branch.lastPipeline = result.build_number;
							}
							
							sendAPIRequest("GET", "repositories/dossiersolutions/dossier-profile/pipelines/" + pipelineIndex + "/steps/")
								.then((result) => {
									for (let stepIndex in result.values) {
										const step = result.values[stepIndex];
										
										if (step.duration_in_seconds > 120) {
											if (!branch.aggregatedSteps[step.name]) {
												branch.aggregatedSteps[step.name] = {};
											}
											
											const aggregatedStep = branch.aggregatedSteps[step.name];
											const stepState = step.state.result ? step.state.result.name : step.state.name;
											const priority = stepStatePriorities[stepState] || -1;
											
											if (!aggregatedStep.state || stepStatePriorities[stepState] > stepStatePriorities[aggregatedStep.state]) {
												aggregatedStep.name = step.name;
												aggregatedStep.state = stepState;
												aggregatedStep.pipeline = pipelineIndex;
											}
										}
									}
									
									processedPipelines++;
									
									if (processedPipelines === pipelineCount) {
										resolve();
									}
								})
								.catch((request) => reject(request));
						})
						.catch((request) => reject(request));
				}
			})
			.catch((request) => reject(request));
	})
	.then(() => {
		window.sessionStorage.setItem("aggregatedPipelineState", JSON.stringify(state));
	});
}

function renderState(state) {
	if (!state) {
		return;
	}
	
	const branchElements = [];
	const mappedBranches = {};
	
	for (let branchIndex in state.branches) {
		const branch = state.branches[branchIndex];
		mappedBranches[branch.lastPipeline] = branch;
	}
	
	const sortedBranches = Object.values(mappedBranches).reverse();
	
	for (let branchIndex in sortedBranches) {
		const branch = sortedBranches[branchIndex];
		const stepElements = [];
		
		for (let stepIndex in branch.aggregatedSteps) {
			const aggregatedStep = branch.aggregatedSteps[stepIndex];
			
			stepElements.push(
				crel("div", {"class": "step"},
					crel("span", {"class": "step-name"}, aggregatedStep.name),
					crel("span", {"class": "step-state status-" + aggregatedStep.state.toLowerCase()}, aggregatedStep.state),
					crel("span", {"class": "step-pipeline"}, "#" + aggregatedStep.pipeline)
				)
			);
		}
		
		branchElements.push(
			crel("div", {"class": "branch"},
				crel("div", {"class": "branch-header"},
					crel("span", {"class": "branch-name"}, branch.name),
					crel("span", {"class": "branch-pipeline"}, "#" + branch.lastPipeline)
				),
				crel("div", {"class": "branch-content"}, stepElements)
			)
		);
	}
	
	const rootElement = crel("div", {"class": "branch-list"}, branchElements);
	
	document.body.querySelector(".container").innerHTML = "";
	document.body.querySelector(".container").appendChild(rootElement);
}

function updateAndRenderState() {
	updateState()
		.then(() => {
			const state = JSON.parse(window.sessionStorage.getItem("aggregatedPipelineState"));
			renderState(state);
		})
		.catch ((request) => {
			document.body.querySelector(".container").innerHTML = "Error: Was unable to update the state (reason: " + request.responseText + ")";
			
			if (request.status === 400 || request.status === 403) {
				window.sessionStorage.setItem("authToken", "");
			}
		});
}

function requestAuthToken() {
	let authToken = window.sessionStorage.getItem("authToken");
	
	if (!authToken) {
		authToken = prompt("Enter authorisation token:");
		
		if (authToken) {
			window.sessionStorage.setItem("authToken", authToken);
		}
		else {
			document.body.querySelector(".container").innerHTML = "Error: No authorisation token specified";
			return false;
		}
	}
	
	return true;
}

function runMainLoop() {
	const state = JSON.parse(window.sessionStorage.getItem("aggregatedPipelineState"));
	
	if (state) {
		renderState(state);
	}
	else {
		updateAndRenderState();
	}
	
	window.setInterval(updateAndRenderState, stateUpdateInterval);
}

document.addEventListener("DOMContentLoaded", function() {
	if (requestAuthToken()) {
		runMainLoop();
	}
});