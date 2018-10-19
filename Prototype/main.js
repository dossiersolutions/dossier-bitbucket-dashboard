const stateUpdateInterval = 30000;
const pipelineCount = 200;

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

function getStepStatePriority(state) {
	switch (state) {
		case "ERROR": return 0;
		case "FAILED": return 0;
		case "SUCCESSFUL": return 0;
		default: return -1;
	}
};

function getPipelineLink(pipelineNumber) {
	return "https://bitbucket.org/dossiersolutions/dossier-profile/addon/pipelines/home#!/results/" + pipelineNumber;
}

function loadData() {
	return new Promise((resolve, reject) => {
		const data = {
			pipelines: {}
		};
		
		sendAPIRequest("GET", "repositories/dossiersolutions/dossier-profile/pipelines/")
			.then((result) => {
				let processedPipelines = 0;
				
				for (let index = result.size; index > result.size - pipelineCount; index--) {
					sendAPIRequest("GET", "repositories/dossiersolutions/dossier-profile/pipelines/" + index)
						.then((result) => {
							const pipelineNumber = result.build_number;
							
							if (!result.target.ref_name) {
								processedPipelines++;
								
								if (processedPipelines === pipelineCount) {
									resolve(data);
								}
								
								return;
							}
							
							data.pipelines[pipelineNumber] = {
								number: pipelineNumber,
								branchName: result.target.ref_name
							};
							
							const pipeline = data.pipelines[pipelineNumber];
							
							sendAPIRequest("GET", "repositories/dossiersolutions/dossier-profile/pipelines/" + pipelineNumber + "/steps/")
								.then((result) => {
									pipeline.steps = result.values;
									processedPipelines++;
									
									if (processedPipelines === pipelineCount) {
										resolve(data);
									}
								})
								.catch((request) => reject(request));
						})
						.catch((request) => reject(request));
				}
			})
			.catch((request) => reject(request));
	});
}

function updateState() {
	return loadData().then((data) => {
		const state = {
			branches: {}
		};
		
		const pipelines = Object.values(data.pipelines).reverse();
		
		for (let pipelineIndex in pipelines) {
			const pipeline = pipelines[pipelineIndex];
			const pipelineNumber = pipeline.number;
			const branchName = pipeline.branchName;
			
			if (!state.branches[branchName]) {
				state.branches[branchName] = {
					name: branchName,
					lastPipeline: pipelineNumber,
					aggregatedSteps: {}
				};
			}
			
			const branch = state.branches[branchName];
			
			for (let stepIndex in pipeline.steps) {
				const step = pipeline.steps[stepIndex];
				
				if (step.duration_in_seconds > 120) {
					if (!branch.aggregatedSteps[step.name]) {
						branch.aggregatedSteps[step.name] = {};
					}
					
					const aggregatedStep = branch.aggregatedSteps[step.name];
					const stepState = step.state.result ? step.state.result.name : step.state.name;
					
					if (!aggregatedStep.state || getStepStatePriority(stepState) > getStepStatePriority(aggregatedStep.state)) {
						aggregatedStep.name = step.name;
						aggregatedStep.state = stepState;
						aggregatedStep.pipeline = pipelineNumber;
					}
				}
			}
		}
		
		window.sessionStorage.setItem("aggregatedPipelineState", JSON.stringify(state));
	});
}

function renderState(state) {
	if (!state) {
		return;
	}
	
	const sortedBranches = Object.values(state.branches).sort((a, b) => b.lastPipeline - a.lastPipeline);
	const branchElements = [];
	
	for (let branchIndex in sortedBranches) {
		const branch = sortedBranches[branchIndex];
		const sortedSteps = Object.values(branch.aggregatedSteps).sort((a, b) => a.name.localeCompare(b.name));
		const stepElements = [];
		
		for (let stepIndex in sortedSteps) {
			const step = sortedSteps[stepIndex];
			
			const stepPipelineAttributes = {
				"class": "step-pipeline",
				"href": getPipelineLink(step.pipeline),
				"target": "_blank"
			};
			
			stepElements.push(
				crel("div", {"class": "step"},
					crel("span", {"class": "step-name"}, step.name),
					crel("span", {"class": "step-state status-" + step.state.toLowerCase()}, step.state),
					crel("a", stepPipelineAttributes, "#" + step.pipeline)
				)
			);
		}
		
		const branchPipelineAttributes = {
			"class": "branch-pipeline",
			"href": getPipelineLink(branch.lastPipeline),
			"target": "_blank"
		};
		
		branchElements.push(
			crel("div", {"class": "branch"},
				crel("div", {"class": "branch-header"},
					crel("span", {"class": "branch-name"}, branch.name),
					crel("a", branchPipelineAttributes, "#" + branch.lastPipeline)
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
		.catch ((error) => {
			document.body.querySelector(".container").innerHTML = "Error: Was unable to update the state (reason: " + (error.responseText || error) + ")";
			
			if (error.status === 400 || error.status === 403) {
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
